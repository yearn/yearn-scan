# Deployment and operations

This is a runbook for a separate production setup. Local installation, tests,
and the demo require no domain, Cloudflare account changes, or live credentials.
Do not send production metadata until the read Access policy is established and
verified. Use a dedicated D1 database, Worker, and Access applications; do not
change `yearn-artifacts`.

## 1. Establish reader Access

In Cloudflare Zero Trust, configure or reuse the GitHub identity provider. Create
a self-hosted Access application for **all of `scan.yearn.dev`**. Its allow
policy must include **GitHub organization = `yearn`** using that identity
provider, with no team restriction unless intentionally narrowing membership.
Do not use a GitHub username, email domain, `Everyone`, or a service-token allow
policy as a substitute. Restrict allowed identity providers to GitHub.

Record the team issuer `https://TEAM.cloudflareaccess.com` and this read
application's Audience (AUD) tag. The Worker trusts this app's membership
decision and checks its signed user JWT; it does not query GitHub membership
itself. Membership revocation takes effect on Access policy/session refresh,
so use a suitable session duration and revoke active sessions when necessary.
See Cloudflare's [GitHub integration](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/github/)
and [JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

Create more-specific Access applications with **Bypass / Include Everyone** for
only these upload paths:

- `scan.yearn.dev/api/v1/upload`
- `scan.yearn.dev/api/v1/upload/*`

Do not bypass `/api/*`, the catalog endpoint, or the whole hostname. A wildcard
child path does not cover the parent path; more-specific applications override
broader applications, as described in [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/).
The Worker authorizes only exact POST-create and PUT-UUID routes with publishing
keys; other methods return `405`, and malformed upload paths fall back to
reader authentication. Bypass suppresses interactive login only, not Worker
authentication. Use the **read application's AUD**, never the bypass app's AUD.

## 2. Prepare D1 and Worker configuration

With authorized Cloudflare operator credentials available to Wrangler:

```sh
pnpm exec wrangler d1 create yearn-scan
cp wrangler.production.example.jsonc wrangler.production.jsonc
```

Edit the ignored production file to set `account_id`, D1 `database_id`,
`ACCESS_ISSUER`, and `ACCESS_AUD`. Keep `APP_ORIGIN` exactly
`https://scan.yearn.dev`, without a trailing slash. Keep `workers_dev: false`
and `preview_urls: false`. Keep `assets.run_worker_first: true`: generated
assets must pass through Worker authentication. Do not deploy the placeholder/local configuration.

```sh
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
WRANGLER_CONFIG=wrangler.production.jsonc pnpm build
pnpm exec wrangler deploy --dry-run --config dist/server/wrangler.json
```

Build with the production source configuration before deploying. Vite emits
the deployable Worker, all server modules, client assets, and a generated
`dist/server/wrangler.json`. Deploy that generated configuration, not the
unbundled TypeScript entry. No vinext deployment CLI or provisioning command is
run by our build. Keep the generated output and `.wrangler` state out of Git.

The initial migration creates reports, generated search columns, indexes, and
an activity counter with transactional triggers. There are no retention jobs.
Queries use the D1 primary; this version does not enable read replicas or use
Sessions. D1 [batch operations are transactional](https://developers.cloudflare.com/d1/worker-api/d1-database/).

## 3. Issue publishing keys

Generate at least 32 random bytes for each key, encoded as base64url (43
characters). Prefix with a nonempty client label: `clientname__apikey`.
Labels permit letters, digits and hyphens, start alphanumeric, and are at most
64 characters. API key strings permit letters, digits, `_`, `-`, and must be
32–256 characters. The double underscore is the separator.

Store the entire comma-separated list as the Worker secret `PUBLISH_KEYS`, not
as a plain Wrangler variable. Use your secret manager or Wrangler's interactive
secret prompt; never place real values in tracked files, command history, or
logs. Spaces around comma-separated entries are trimmed. Invalid or duplicate
entries cause publishing to fail closed.

```sh
pnpm exec wrangler secret put PUBLISH_KEYS --config wrangler.production.jsonc
```

This command can create the Worker before the first deploy; it does not require
making a domain public. Alternatively deploy the protected Worker first with
publishing closed, then set the secret. Give each client only its complete entry.
To issue/revoke a key, edit the secret list. Revocation blocks future writes;
existing catalog records remain visible to authorized readers. Replacement keys
do not inherit ownership, even with the same client label. Store the issued
key and returned record IDs securely. No key-management HTTP API exists.

## 4. Attach the domain and deploy last

After the Access policies are configured, use the production template's custom
domain route and deploy:

```sh
WRANGLER_CONFIG=wrangler.production.jsonc pnpm build
pnpm exec wrangler deploy --config dist/server/wrangler.json
```

The `yearn.dev` zone must already be in the correct Cloudflare account. A Worker
[custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
attaches the subdomain and certificate; this does not register a new apex domain.
Verify both the [workers.dev route](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
and [preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
remain disabled after deployment. The Worker also rejects any origin other
than its configured origin before authentication or database access.

## 5. Production acceptance

Use synthetic metadata and a harmless externally hosted HTTPS report first:

1. In a logged-out browser, `/` and `/api/v1/reports` must require Access login.
   A nonmember GitHub account must be denied; a `yearn` member must see the table.
   Check a generated `/_next/static/` asset and an RSC request too: neither may
   bypass Access, and Worker responses must remain private and `no-store`.
2. Without a publishing key, POST to the exact upload route must reach Worker
   JSON `401` (not an interactive login redirect). Wrong methods return `405`.
3. Create a synthetic record via CLI. Confirm `201`, its ID/update URL, and its
   presence in the member's table. The publishing key alone must not read the
   catalog. Replay the create and confirm `200` with the same ID.
4. Change its metadata and PUT with the owning key. Reload the page and check
   ordering/activity. Repeat that PUT and confirm `changed: false`.
5. Open its report link. Confirm it reaches the client's URL and that the
   destination enforces its own login/access requirements.
6. Verify a second key cannot update it, revoke the owning key and verify `401`,
   then restore the intended secret list. Confirm alternate Worker/preview
   hostnames cannot expose the catalog or accept writes.
7. Delete the synthetic record with the operator command in the README.

The local browser smoke test verifies application behavior with locally signed
JWTs. It cannot verify real GitHub membership policy, DNS, Cloudflare Access
path precedence, or the external report service's authentication. Those checks
remain part of this separate production rollout.

## Recovery

On a D1 error, clients receive `503`; there are no application retries. Preserve
the original run ID and payload when manually retrying a create after an
ambiguous result. A failed D1 batch rolls back all its changes. Use D1's operator
backup/Time Travel facilities for recovery; review retention and restoration
requirements with the account operator. Never reset the activity clock during
routine maintenance. Deleting a report naturally recomputes repository ordering
from the remaining records; no stale repository summary rows remain.

Keep request bodies, bearer keys, JWTs, and private report URLs out of logs. The
Worker emits no such data and returns generic database failures. Monitor
platform error rates and D1 usage separately if operational monitoring is needed.
