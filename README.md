# Yearn Scan

A private catalog of scan metadata and externally hosted report links, designed
for `scan.yearn.dev`. One Cloudflare Worker serves the UI and API; D1 stores the
records. The UI uses vinext App Router, React Server Components and Tailwind CSS.
Clients run their own scanners and host their own reports. There are no
file uploads, report rendering, R2 buckets, or background jobs.

Production deployment, Cloudflare Access, and domain attachment are a separate
operator step. Nothing in installation, checks, or the demo provisions resources.
`yearn-artifacts` is independent and unchanged.

## Local development

Use Node 24 and pnpm 11.5.2:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo
```

Open `http://127.0.0.1:3000` for a complete local table with synthetic data.
The demo binds only to loopback and discards data on exit. Its local proxy signs
test Access JWTs; the production Worker contains no authentication bypass.

For Vite development with hot reload and persistent local D1:

```sh
pnpm db:migrate
# Write a local-only PUBLISH_KEYS entry to .dev.vars using your editor.
pnpm dev
```

Use `http://127.0.0.1:3000` (the configured origin). Stop the demo first; both
commands use port 3000 and fail if it is occupied. Local `.dev.vars` and D1 state
are ignored by Git. `PUBLISH_KEYS` uses the same format as production. Reads on
`pnpm dev` remain closed until valid Access issuer/audience/JWTs are configured;
use `pnpm demo` for an isolated UI preview. The demo runs the production build
with three synthetic reports and local test JWTs; restart it after code changes.
Vite is bound to loopback; its development tooling is not a production server.

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

An existing compatible Chromium can be selected using
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chrome` if the browser
download is unavailable. The smoke test signs local JWTs, runs the real Worker
and D1, and intercepts the external report destination. It never contacts
production or changes Access configuration.

## App structure

- `app/page.tsx` reads D1 on the server and passes initial results to the table.
- `app/catalog-table.tsx` is the interactive React client component.
- `app/api/v1/reports/route.ts`, `app/api/v1/upload/route.ts` and
  `app/api/v1/upload/[id]/route.ts` expose the existing JSON contract.
- `src/index.ts` wraps vinext with origin, method and Access checks, including
  RSC requests and generated assets. Only exact upload routes use publishing keys.
- `src/` holds validation, authentication and D1 operations; `migrations/` is
  unchanged by the framework migration.

To add an endpoint, create `app/api/whatever/route.ts` and export its method
handler. The outer Worker permits only authenticated reader GETs outside the
existing upload routes; intentionally change that boundary for any new method.
The initial page queries D1 directly rather than making an internal API request.
It is always rendered per request; neither page nor API data enters a shared
cache. React escapes submitted text; a fresh CSP nonce permits hydration scripts.

`pnpm build` creates `dist/server/` (Worker/RSC/SSR code and generated Wrangler
configuration) and `dist/client/` (browser JS/CSS). Test helpers execute those
artifacts with real workerd/D1 and keep assets behind the Worker boundary.

## Publish a report

Set `YEARN_SCAN_PUBLISH_KEY` to a full issued `clientname__apikey` token. Set
`YEARN_SCAN_URL` to an origin if it differs from `https://scan.yearn.dev`.
Keep the same `run_id` and original payload when retrying a create.

```sh
pnpm upload create examples/report.json
pnpm upload update REPORT_ID examples/report.json
```

The CLI validates metadata locally, never follows redirects with a key, and
does not retry requests. An update sends a full replacement, including the
original `run_id`. See [API contract](docs/api.md) for curl examples and semantics.

## Authentication and operations

Publishing keys authorize creates for any repository and updates to records
owned by that exact key. They cannot read the catalog or administer the service.
Ownership uses a SHA-256 fingerprint; raw keys are not stored in D1.

The UI, assets, and catalog API require a signed Cloudflare Access application
JWT. Access must restrict membership to the `yearn` GitHub organization. The
Worker validates issuer, audience, RS256 signature, and time/user claims. All
responses are private and `no-store`. Only exact upload routes accept bearer
authentication. Alternate origins are rejected even with a valid JWT.

See [deployment and operations](docs/deployment.md) before exposing production
data. Records are retained indefinitely. An operator can delete one explicitly:

```sh
pnpm delete-report --local REPORT_ID
pnpm delete-report --remote REPORT_ID --config wrangler.production.jsonc
```

Deletion requires Cloudflare/D1 operator access, not a publishing key, and frees
that key's `run_id` for reuse. Backups may retain deleted data according to D1's
recovery policy. There is no application administration endpoint.

## Boundaries

The catalog records what clients submit; it does not verify scanner findings,
GitHub commits, or report availability. Report URLs are never fetched by the
Worker and retain their own destination access controls. Avoid putting secrets
or signed credentials in report URLs or metadata.

Scanner execution, scheduling, GitHub synchronization, historical imports,
finding comparison, and ownership transfers are outside v1. Pagination is a
live view, not a historical snapshot; refresh from page one after concurrent
changes. Dependency decisions are in [docs/dependencies.md](docs/dependencies.md).
