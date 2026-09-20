# API v1

Requests and responses use JSON. Mutation bodies must be `application/json`,
uncompressed, and at most 16 KiB. Unknown fields are rejected. The source of
runtime validation is `src/schema.ts`; the portable contract is
[submission.schema.json](submission.schema.json). No request fetches a report URL.

## Submission

| Field | Contract |
| --- | --- |
| `schema_version` | Required integer `1` |
| `run_id` | Required 1–128 characters; starts alphanumeric, then letters, digits, `.`, `_`, `:`, `-`. Unique per publishing key; immutable on PUT |
| `repository` | Required GitHub `owner/repo`; normalized to lowercase; owner up to 39 and repository up to 100 characters |
| `commit_sha` | Required full 40-character hexadecimal Git SHA-1; normalized to lowercase |
| `ref` | Optional string, up to 255 characters, or `null` |
| `pr_number` | Optional positive safe integer or `null`; required for `ai-pr` |
| `pr_title` | Optional nonempty PR title up to 512 characters or `null` |
| `pr_url` | Optional safe absolute HTTPS URL or `null`, same URL rules as `report_url` |
| `scan_type` | Required 1–64 character lowercase slug matching `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`; open vocabulary |
| `scanner` | Required `{ "name": "...", "version": "..." }`; nonempty strings up to 128 characters each |
| `ai_model` | Optional nonempty string up to 128 characters or `null` |
| `started_at`, `finished_at` | Required valid UTC timestamps: `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.sssZ`; `finished_at` may be `null`; a supplied finish must not precede start |
| `status` | Required `running`, `completed`, or `failed`; execution outcome, not security severity |
| `severity_counts` | Required object with all five keys: `critical`, `high`, `medium`, `low`, `info`; each is a nonnegative safe integer or `null` |
| `report_url` | Required `null` or absolute HTTPS URL, up to 4096 characters, without credentials, whitespace, or backslashes |

Strings cannot contain ASCII control characters. Use `null` when a count is
unavailable; zero means the scanner reported no findings at that severity.
Completion time and report URL may be null in any execution state. No field
combinations or state transitions are enforced based on status. Failed scans
can link to a client-hosted diagnostic report. Timestamps describe
execution and do not control catalog ordering. Ref, PR metadata, and model default
to `null`; timestamps normalize to millisecond UTC. Repository and commit case,
optional nulls, timestamp precision, and JSON key order are canonicalized before
idempotency comparisons. Submitted text is preserved; visible client and PR text is rendered as text.

Suggested scan types (custom slugs are accepted):

| Type | Meaning |
| --- | --- |
| `ai-repo` | AI review of a repository at a commit |
| `ai-pr` | AI pull-request review; `pr_number` required |
| `dependency`, `supply-chain` | Package vulnerabilities or dependency provenance |
| `secrets` | Exposed credentials or sensitive material |
| `static-analysis` | Code analysis and lint/security rules |
| `smart-contract` | Contract-specific analysis |
| `infrastructure`, `domain` | Infrastructure, service, or domain checks associated with a repository |

## Create

`POST /api/v1/upload` with `Authorization: Bearer clientname--apikey`.
The client name comes from configured keys, never from submitted metadata.

```sh
curl --fail-with-body --request POST \
  --header "Authorization: Bearer ${YEARN_SCAN_PUBLISH_KEY}" \
  --header 'Content-Type: application/json' \
  --data-binary @examples/report.json \
  https://scan.yearn.dev/api/v1/upload
```

```json
{
  "id": "12345678-1234-4123-8123-123456789abc",
  "update_url": "https://scan.yearn.dev/api/v1/upload/12345678-1234-4123-8123-123456789abc",
  "created": true,
  "created_at": "2026-09-17T10:00:00.000Z",
  "updated_at": "2026-09-17T10:00:00.000Z"
}
```

New records return `201` and a `Location` header. Identical canonical create
retries return the same ID with `200` and `created: false`; no activity changes.
A reused run ID with different create metadata returns `409`. The immutable
original create payload is retained, so a delayed POST retry after a PUT still
succeeds without reverting the update. The same run ID from another key creates
an independent record. Save the response ID/update URL; keys cannot list records.

## Replace metadata

`PUT /api/v1/upload/{id}` requires the original publishing key. Submit the whole
body again, with the same `run_id` and schema version. Optional fields omitted
from PUT become null. Repository and other submitted metadata may be corrected.
Ownership, client attribution, original create payload, and creation time stay
unchanged. Missing or differently owned IDs return `404`; changed run IDs return
`409`. A revoked key returns `401` even for its former records.

```sh
curl --fail-with-body --request PUT \
  --header "Authorization: Bearer ${YEARN_SCAN_PUBLISH_KEY}" \
  --header 'Content-Type: application/json' \
  --data-binary @examples/report.json \
  "https://scan.yearn.dev/api/v1/upload/${REPORT_ID}"
```

Returns `200` with `id`, `update_url`, `created_at`, `updated_at`, and `changed`.
Identical PUTs return `changed: false` without advancing activity. Concurrent
different PUTs use last accepted write wins; each complete mutation is atomic.
There is no ETag/optimistic concurrency contract in v1.

## Read catalog

`GET /api/v1/reports` requires a valid `Cf-Access-Jwt-Assertion` from the protected
read application. Publishing keys do not satisfy this requirement.

| Query | Meaning |
| --- | --- |
| `q` | Case-insensitive literal repository substring, up to 140 characters |
| `scan_type` | Exact scan-type slug |
| `status` | `running`, `failed`, highest reported severity (`critical`, `high`, `medium`, `low`, `info`), or `no-findings`; `completed` remains available through the API/URL |
| `limit` | Page size, 1–100; default 50 |
| `cursor` | Opaque `next_cursor` from the previous response |

Response: `{ "schema_version": 1, "repositories": ["yearn/vaults"], "reports": [...], "next_cursor": "..." }`.
Each report includes the normalized submission plus `id`, configured `client`,
`created_at`, and `updated_at`. Ownership fingerprints and original payloads
are not returned. `next_cursor: null` means the last page. `repositories` is a
sorted distinct list from the whole catalog, independent of filters and pagination.
The UI applies repo and status immediately; `scan_type` remains supported in URLs
and the API. Severity filters match completed scans by their highest positive
count. `no-findings` matches completed scans with all five counts exactly zero;
null counts remain unavailable. Unknown results appear under All only.
Running rows refresh every 15 seconds while the tab is visible.

Repository order uses each repository's latest accepted create/change, including
reports hidden by the current scan-type/status filter. Within each repository,
reports sort by latest change. D1 triggers allocate a unique monotonic activity
sequence inside each write transaction; repository name and report ID are
additional deterministic tie-breakers. Execution timestamps are never used for
ordering. Cursor parameters bind to all filters and page size; reset the cursor
when those change. Unknown or duplicate query parameters are errors.

Pagination stays stable for an unchanged catalog. It is not a snapshot across
requests: concurrent writes/deletions can move a repository across a cursor,
causing repeated or omitted records while paging. Start again at page one to
see the current ordering. No historical pagination state is retained.

## Errors and transport

Errors are `{ "error": "description" }`: `400` schema/query/JSON errors, `401`
invalid credentials, `404` missing or unowned update, `405` wrong method with
`Allow`, `409` idempotency/immutable-field conflict, `413` oversized body, `415`
unsupported media/encoding, `421` unrecognized origin, or `503` unavailable
configuration/database. Cloudflare Access may instead redirect an unauthenticated
reader to login before it reaches the Worker.

Every response includes `Cache-Control: private, no-store`. There is no CORS
publishing interface. The Worker makes one D1 batch per mutation, with no
application-level retries. A failed batch rolls back its record and activity
changes. After an ambiguous network failure, a client may explicitly retry its
original POST with the same run ID; platform-level execution is outside the
application's retry policy. Do not use a new run ID merely to retry a request.
