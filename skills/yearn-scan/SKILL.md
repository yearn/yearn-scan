---
name: yearn-scan
description: Publish scan or review metadata and externally hosted report links to Yearn Scan, or update an existing scan record. Use when asked to submit results to scan.yearn.dev; this skill does not run scanners or host report files.
---

# Yearn Scan

Publish to https://scan.yearn.dev using the bundled Node.js helper. Resolve
`scripts/publish.mjs` relative to this SKILL.md, not the user's working directory.
The helper is standalone and requires Node.js 22 or newer, with no npm install.

## Prepare the submission

Use the actual scanner output, scanned repository and full commit SHA. Do not
infer the scanned commit from the current checkout if the report targets a
PR or another revision. Preserve reported severities; use `null` for an unknown
count and `0` only for a confirmed zero. Do not invent timestamps, tool versions,
model names, findings, or report URLs. Ask for missing required information.

Yearn Scan stores metadata and a link; it does not upload or render report files.
Use an existing HTTPS report URL, or `null` if no hosted report is available.
Hosting a report is a separate action requiring the user's authorization. Report
links retain their destination's access controls. Never put credentials or signed
access tokens in metadata or URLs.

Write a JSON submission file with these fields. Unknown fields are rejected;
the entire body must be at most 16 KiB and strings must not contain control
characters.

| Field | Value |
| --- | --- |
| `schema_version` | `1` |
| `run_id` | Stable identifier for this scan, 1–128 characters; starts alphanumeric, then letters, digits, `.`, `_`, `:`, `-` |
| `repository` | GitHub `owner/repo`; owner up to 39 characters, repo up to 100 |
| `commit_sha` | Full 40-character hexadecimal commit SHA |
| `scan_type` | Lowercase slug up to 64 characters, e.g. `ai-pr`, `ai-repo`, `dependency`, `smart-contract`, `static-analysis` |
| `scanner` | Object with nonempty `name` and `version` strings, each at most 128 characters |
| `started_at` | UTC timestamp: `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.sssZ` |
| `finished_at` | Same format, not before start, or `null` |
| `status` | `running`, `completed`, or `failed`; severity is separate |
| `severity_counts` | Object containing `critical`, `high`, `medium`, `low`, `info`; each a nonnegative safe integer or `null` |
| `report_url` | HTTPS URL without embedded credentials, whitespace, or backslashes, at most 4096 characters, or `null` |

Optional fields: `ref` (up to 255 characters), `pr_number` (positive integer),
`pr_title` (up to 512 characters), `pr_url` (same URL rules), and `ai_model` (up to
128 characters). Optional text must be nonempty when supplied, or `null`.
`ai-pr` requires `pr_number`. Include the actual PR title and link when available
so the catalog provides useful context.

## Authenticate and publish

Check `YEARN_SCAN_PUBLISH_TOKEN` in the shell environment. The helper also accepts
`YEARN_SCAN_PUBLISH_KEY` for compatibility with the repository CLI; TOKEN takes
precedence. The value is the full `clientname--apikey` token. The first `--`
separates the client label from the key. Labels start alphanumeric and contain
letters, digits, or single hyphens, up to 64 characters; the key is 32–256 letters,
digits, underscores, or hyphens.

If the user stores the token in `~/.env`, load it into the helper process with
Node's `--env-file` option. Do not display the file or token, put secrets in command
arguments, or copy them into the submission. Example commands below use
`/path/to/yearn-scan` to stand for the installed skill directory:

```sh
node /path/to/yearn-scan/scripts/publish.mjs create /path/to/submission.json
# When credentials are stored in ~/.env:
node --env-file="$HOME/.env" /path/to/yearn-scan/scripts/publish.mjs create /path/to/submission.json
```

A request to publish authorizes the submission; do not ask for another confirmation
unless a concrete missing detail or execution permission requires it. Merely
running a scan does not authorize publishing its results.

The helper defaults to `https://scan.yearn.dev`. Use `YEARN_SCAN_URL` only when the
user intends another trusted HTTPS origin. It rejects redirects and does not
retry requests automatically. Do not work around an Access redirect by forwarding
the publishing token to a login host.

After success, retain the returned `id`, original submission and `run_id` for
updates or retries. Give the user the record ID and a catalog link filtered to
the URL-encoded repository: `https://scan.yearn.dev/?q=OWNER%2FREPO`. The catalog
requires a Yearn member's GitHub login; the publishing token cannot read it.
Leave published records in place unless the user requests deletion. Deletion is
an operator task and is not supported by publishing keys or this helper.

## Updates and failures

Update with the same exact publishing token, returned record ID and original
`run_id`. Send the full replacement payload, including optional fields to retain;
omitted optional fields become null.

```sh
node /path/to/yearn-scan/scripts/publish.mjs update REPORT_ID /path/to/submission.json
```

For a running scan, retain the create response and update that record when the
scan completes or fails. Do not create a second record for its final state.
Identical updates return `changed: false`. Replacement keys do not inherit record
ownership, even when their client labels match.

On a timeout or ambiguous failure, stop and report uncertainty. If retrying is
appropriate, resend the original create payload with the same `run_id` and token;
never generate a new run ID just to retry. Identical creates return the same ID
with HTTP 200 instead of 201. A delayed original create retry after an update
also preserves the updated record.

- `400`, `413`, `415`: fix the payload or request format.
- `401`: check the publishing credential without printing it.
- `404` on update: record is missing or owned by another key.
- `409`: changed create payload for an existing run, or changed update `run_id`.
- `503`: service configuration/database issue; do not rotate keys or create new runs blindly.
- Redirect or edge-level `403`: report the access/edge failure; do not bypass it.
