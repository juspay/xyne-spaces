---
name: dashboard-data
description: Build truthful self-contained dashboard snapshots from connected MCP/data tools or user-provided datasets. Use for /dashboard runs that query real metrics, render charts or operational summaries, and may be refreshed by scheduled jobs.
---

# Dashboard data

Follow this order; data retrieval is a hard gate before visual composition.

1. Identify the requested measures, dimensions, time window, timezone, and comparison period.
2. Inspect available read-only data tools. Query the authoritative source and retain the exact query/window needed to explain the snapshot.
3. If no suitable tool or supplied dataset is available, stop. Name the missing connection. Never invent placeholder values, convert guesses into metrics, or deliver a sample dashboard.
4. Check basic integrity: units, aggregation level, missing intervals, duplicate series, timezone, and whether counters require rate/increase rather than raw values.
5. Build a self-contained HTML snapshot with no runtime fetches, tokens, cookies, internal URLs, or embedded credentials.
6. Show `Data as of <timestamp with timezone>`, the reporting window, and a human-readable source label. Do not expose secret query parameters.
7. Use stable card order, chart domains, colors, labels, and DOM structure across refreshes. A scheduled refresh should change the data, not randomly redesign the dashboard.
8. Present unavailable metrics as unavailable; do not coerce missing data to zero.
9. QA desktop and mobile layouts, chart legibility, empty/error states, console output, and network requests before delivery.

If the user explicitly asks for a recurring refresh, schedule the same complete `/dashboard` brief only after the first verified snapshot succeeds. Preserve the original conversation target. Never schedule implicitly, and never let a scheduled dashboard schedule another run.

Prefer KPI cards only for decision-driving headline values. Use lines for trends, bars for comparisons, tables for exact lookup, and annotations for threshold crossings. Include a concise textual takeaway adjacent to each complex chart.

Treat the artifact as a verified snapshot. The delivered HTML must remain useful offline and must never contact the underlying data source when opened or shared.
