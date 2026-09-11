---
name: charts
description: When and how to turn metrics in your answer into a chart with the `visualize` tool — which visualType fits which shape of data, the exact `data` payload each type expects, and the rules for emitting the ```chart block so it actually renders. Load before answering anything whose answer contains counts, totals, trends, breakdowns, proportions, or before/after comparisons.
---

# Charting metrics in an answer

A number buried in a paragraph is easy to miss. A chart makes the shape of the
data obvious at a glance. The `visualize` tool renders one using the same chart
components the Analytics dashboards use, so a chart in chat looks identical to
the same chart on a dashboard.

## When to chart

Chart whenever your answer contains numbers whose **shape** carries meaning:

- a metric broken down by category (per team, per service, per merchant)
- anything moving over time (weekly volume, daily errors, month-over-month)
- parts of a whole (share of traffic, split by status)
- a before/after or current-vs-previous comparison
- a single headline figure the whole answer is about

This is **not** limited to analytics questions. "How did the migration go?" or
"what's been happening in #payments?" often end up with countable findings —
tickets by status, PRs per week, errors before and after a deploy. Those chart
well.

**Skip it** when:

- there's one incidental number that reads fine in a sentence ("3 people replied")
- the numbers have no comparison, trend, or breakdown — a chart of one bar is noise
- you're unsure of the figures. Never chart to look thorough

Prefer **one** well-chosen chart plus prose over several marginal ones.

## Never invent data

`visualize` renders only; it does not fetch or compute anything. Every number
must come from a tool result or the conversation. If you have partial data, say
so in prose — do not fill gaps to make a chart look complete. A chart reads as
authoritative, so a fabricated point is worse than no chart.

## Picking a visualType

| Your data | visualType |
|---|---|
| Comparing categories | `BAR_CHART` |
| A trend over time | `LINE_CHART`, or `AREA_CHART` for volume |
| Proportions of a whole (≤6 slices) | `PIE_CHART` / `DONUT_CHART` |
| One headline number | `KPI` |
| Current vs. previous period | `KPI_COMPARE` |
| Two variables against each other | `SCATTER_CHART` |
| Rows worth reading individually | `DATA_TABLE` |

Prefer a bar chart over a pie beyond ~6 categories — slices become unreadable.
Use a table when the exact values matter more than the shape.

## The `data` payload

Each type takes one shape. Get this right and the call succeeds first time:

```
BAR_CHART / PIE_CHART / DONUT_CHART
  [{ "label": "Bug", "value": 12 }, { "label": "Feature", "value": 5 }]

LINE_CHART / AREA_CHART / SCATTER_CHART
  [{ "x": "2026-07-01", "y": 34 }, { "x": "2026-07-08", "y": 41 }]
  add "series": "<name>" to a point to plot multiple lines

KPI
  { "value": 42, "label": "Open tickets" }

KPI_COMPARE
  { "current": 42, "previous": 37, "label": "Open tickets" }

DATA_TABLE
  { "columns": [{ "key": "team", "label": "Team" },
                { "key": "count", "label": "Count", "type": "number" }],
    "rows": [{ "team": "Payments", "count": 12 }] }
```

Sort bar-chart data most-significant first, and keep it to the top ~10 —
truncate and say so in prose rather than rendering 50 unreadable bars.

If the tool returns a validation error it tells you which field is wrong. Fix
the payload and call again; don't fall back to describing the chart in words.

## Emitting the block

On success the tool returns a fenced ` ```chart ` block. **Copy it into your
reply exactly as returned, character for character.** It renders only when
reproduced verbatim — rewording, reformatting, pretty-printing, or truncating
the JSON silently produces no chart.

Put the chart next to the prose it supports, and still state the key takeaway in
words: the chart shows the shape, your sentence says what it means. Don't
narrate the chart's construction ("I've plotted this as a bar chart") — just
present the finding and let the chart sit alongside it.
