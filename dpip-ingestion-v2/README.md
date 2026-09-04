# DPIP daily ingestion (v2)

TypeScript HTTP ingestion function for the DPIP daily registry datasets,
v2 payload contract.

Deployed as its own Cloud Run service, separate from `dpip-ingestion/`.
Both services use the same Cloud SQL instance, the same database, and the
same `dpip` schema; v2's tables carry a `_v2` suffix so they sit alongside
v1's without colliding. Set `DB_NAME` to the same value the v1 service uses.
The two are triggered by different email subjects and must not share a
`DPIP_BEARER_SECRET`.

Differences from v1:

- `reports` carries `customer_type` (`INDIVIDUAL` / `MERCHANT` / `ALL`).
- `screenings` carries `event_type`.
- A seventh table, `entities_by_customer`, splits distinct flagged external
  entities by owning party (`party_id`, `all` for the registry-wide row) and
  by the segment they were reported under.
- Snapshot-table unique keys exclude their count columns.

Each successful invocation:

1. Writes all seven payload tables in one database transaction.
2. Reads a consistent snapshot containing all rows from all seven tables.
3. Injects that snapshot into `Report.html` and `DPIP_Overview.html`.
4. Uploads both generated HTML files as attachments on one message in the
   configured Xyne Spaces channel.

The HTML is uploaded as `text/html`; its source is not placed inline in the
channel message.

## Layout

- `src/`: authoritative TypeScript source.
- `migrations.md`: ordered database migration history.
- `test/`: parser tests, smoke-test script, and fixtures.
- `console-source/index.js`: generated single-file source for console deployment.
- `Report.html`: detailed operational report template.
- `DPIP_Overview.html`: cumulative/monthly overview report template.

## Commands

```sh
npm test
npm run build
```

`npm run build` compiles `dist/` and regenerates
`console-source/index.js` from `src/index.ts`.

The deployed HTTP function target is `ingestDpip`.

## Environment

Database and ingestion authentication:

- `INSTANCE_CONNECTION_NAME`
- `DB_HOST` (optional; defaults to the Cloud SQL socket)
- `DB_PORT` (optional; defaults to `5432`)
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DPIP_BEARER_SECRET`

Xyne Spaces report delivery:

- `XYNE_SPACES_API_URL`: Xyne Spaces backend origin, without `/api`.
- `XYNE_SPACES_APP_JWT`: JWT generated for the installed Xyne app.
- `XYNE_SPACES_CHANNEL_ID`: destination channel ID.
- `XYNE_SPACES_MESSAGE` (optional): attachment message text.
- `DPIP_REPORT_TEMPLATE_PATH` (optional): report template path; defaults to
  `Report.html` in the function working directory.
- `DPIP_OVERVIEW_TEMPLATE_PATH` (optional): overview template path; defaults to
  `DPIP_Overview.html` in the function working directory.

The installed app needs `files:write`, and its app user must be a participant
in the destination channel.

## Database setup

Apply the ordered migrations documented in `migrations.md`.

## Runtime logs

The function writes one-line structured JSON logs. Every handler log includes
an `event`; request-scoped logs also include `request_id` when the caller sends
`X-Request-Id` or Cloud Run supplies a trace header. No bearer token, app JWT,
HTML body, or DPIP row content is logged.

Main success events, in execution order:

- `dpip_ingestion_request_received`
- `dpip_payload_parsed`
- `dpip_database_write_completed`
- `dpip_report_snapshot_loaded`
- `dpip_report_template_loaded`
- `dpip_overview_template_loaded`
- `dpip_report_generated`
- `dpip_report_upload_started`
- `dpip_report_upload_completed`
- `dpip_ingestion_completed`

Failure events identify their boundary and include safe error details:

- `dpip_ingestion_request_rejected`
- `dpip_ingestion_configuration_failed`
- `dpip_payload_rejected`
- `dpip_database_table_write_failed`
- `dpip_database_table_read_failed`
- `dpip_database_rollback_failed`
- `dpip_database_report_snapshot_rollback_failed`
- `dpip_database_pool_error`
- `dpip_report_snapshot_load_failed`
- `dpip_report_template_load_failed`
- `dpip_overview_template_load_failed`
- `dpip_report_upload_request_failed`
- `dpip_report_upload_response_read_failed`
- `dpip_report_upload_failed`
- `dpip_ingestion_failed`

`dpip_ingestion_failed` includes `pipeline_stage`, `error_type`,
`error_message`, `error_stack`, and timings. A Xyne API rejection also emits
`dpip_report_upload_failed` with `http_status`, `app_error`, response content
type, and whether the response was JSON.
