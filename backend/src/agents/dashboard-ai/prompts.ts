import { config } from '@/config/env';
import { ColumnSummaryCodec } from '@/types/dataSource';
import type { DashboardPlan } from '@xyne/shared';

function sanitizeForPrompt(s: string, maxLen = 120): string {
  return s
    .replace(/[^A-Za-z0-9 _.\-/]/g, '_')
    .slice(0, maxLen);
}

interface BuildSystemPromptArgs {
  dataSourceName: string;
  dataSourceId: string;
  sourceType: string;
  tables: ReadonlyArray<{
    schemaName: string;
    tableName: string;
    columns: ReadonlyArray<{
      columnName: string;
      dataTypeCanonical: string | null;
      summary?: string | null;
    }>;
  }>;
  totalTableCount: number;
  relationships: ReadonlyArray<{
    cardinality: string;
    fromColumn: { columnName: string; table: { schemaName: string; tableName: string } };
    toColumn: { columnName: string; table: { schemaName: string; tableName: string } };
  }>;
}

function renderColumnHints(
  dataTypeCanonical: string | null,
  summaryJson: string | null | undefined,
): string {
  const dt = sanitizeForPrompt(dataTypeCanonical ?? 'unknown', 20);
  if (!summaryJson) return dt;
  let parsed;
  try {
    parsed = ColumnSummaryCodec.parse(summaryJson);
  } catch {
    return dt;
  }
  const parts: string[] = [];
  const distinct = parsed.distinctCountApprox;
  if (typeof distinct === 'number' && distinct > 0) {
    if (parsed.valuesAreExhaustive && distinct <= config.dashboard.aiTopValuesInlineLimit && parsed.topValues) {
      const vals = parsed.topValues
        .map(v => sanitizeForPrompt(String(v.value), 40))
        .slice(0, config.dashboard.aiTopValuesInlineLimit)
        .join(', ');
      parts.push(`distinct=${distinct}, values: ${vals}`);
    } else {
      parts.push(`~${distinct} distinct`);
    }
  }
  return parts.length > 0 ? `${dt} [${parts.join('; ')}]` : dt;
}

export function buildSystemPrompt(args: BuildSystemPromptArgs): string {
  const { dataSourceName, dataSourceId, sourceType, tables, totalTableCount, relationships } = args;
  const safeName = sanitizeForPrompt(dataSourceName);
  const truncationNote =
    totalTableCount > tables.length
      ? `\n\n(Note: ${tables.length} of ${totalTableCount} tables are shown above. The remaining ${totalTableCount - tables.length} were truncated to keep the prompt size manageable. If a user asks for a table you don't see here, do NOT claim it doesn't exist — instead call \`suggest_components\` to ask them to pick from the listed tables, or have them adjust their data-source filters.)`
      : '';
  const schemaSummary = tables
    .map(t => {
      const schemaName = sanitizeForPrompt(t.schemaName, 63);
      const tableName = sanitizeForPrompt(t.tableName, 63);
      const cols = t.columns
        .map(c => {
          const col = sanitizeForPrompt(c.columnName, 63);
          const hints = renderColumnHints(c.dataTypeCanonical, c.summary);
          return `${col}:${hints}`;
        })
        .join(', ');
      return `- ${schemaName}.${tableName} (${cols})`;
    })
    .join('\n');

  let joinsGuidance: string;
  if (sourceType === 'clickhouse') {
    joinsGuidance = relationships.length === 0
      ? `(ClickHouse: no FK constraints exist. You may join ANY two tables on ANY two columns of compatible type (text-to-text, number-to-number, date-to-date). The executor allows arbitrary joins on this source — just pick semantically sensible columns from the schema above.)`
      : relationships
          .map(r => {
            const from = `${sanitizeForPrompt(r.fromColumn.table.tableName, 63)}.${sanitizeForPrompt(r.fromColumn.columnName, 63)}`;
            const to = `${sanitizeForPrompt(r.toColumn.table.tableName, 63)}.${sanitizeForPrompt(r.toColumn.columnName, 63)}`;
            const card = r.cardinality === 'one_to_one' ? '(one-to-one)' : '(many-to-one)';
            return `- ${from} → ${to} ${card}`;
          })
          .join('\n') + `\n\n(ClickHouse: the relationships above are workspace-defined. You may also join ANY two tables on compatible-type columns even if not listed — the executor allows arbitrary joins on this source.)`;
  } else {
    joinsGuidance = relationships.length === 0
      ? '(No FK relationships were introspected — joins are not available on this data source.)'
      : relationships
          .map(r => {
            const from = `${sanitizeForPrompt(r.fromColumn.table.tableName, 63)}.${sanitizeForPrompt(r.fromColumn.columnName, 63)}`;
            const to = `${sanitizeForPrompt(r.toColumn.table.tableName, 63)}.${sanitizeForPrompt(r.toColumn.columnName, 63)}`;
            const card = r.cardinality === 'one_to_one' ? '(one-to-one)' : '(many-to-one)';
            return `- ${from} → ${to} ${card}`;
          })
          .join('\n');
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  return `You compose a dashboard for the user by calling tools. You CANNOT execute SQL; you must emit a JSON queryPlan that the system will run.

Today's date is ${today} (${dayOfWeek}, timezone ${tz}). When the user says "today", "this week", "last month", "this quarter", "YTD", etc., translate to concrete date filters using this date as the anchor.

The user has selected the data source named ${safeName} (id: ${dataSourceId}, type: ${sanitizeForPrompt(sourceType, 20)}). These are the introspected tables and columns you may reference. Column hints in brackets show data shape from EDA: \`distinct=N, values: ...\` means the column is enum-like — feel free to filter on those exact values. \`~N distinct\` means it's high-cardinality (e.g. emails, ids) — don't treat as a category.

${schemaSummary}${truncationNote}

Joins / relationships:

${joinsGuidance}

Business glossary — common phrases users employ. Use these when a prompt is informal:
- "best customers" / "top customers" → top by sum(orders.total_amount) (or equivalent revenue column) DESC, joining orders→customers if needed
- "happiest customers" → highest avg(support_tickets.csat) DESC for closed tickets
- "high risk" / "likely to churn" → highest churn_risk_score / churn_score, or recent inactivity
- "active" customers/users → is_active = true (when the column exists)
- "engaged" / "power users" → highest count of activity (orders, sessions, messages, etc.)
- "VIP" → top spenders or top by usage
- "revenue" / "sales" / "income" → sum of order/payment amount columns; pick whichever exists
- "orders" used as a noun in count-style prompts → count(orders.id)
- "growth" → trend over time (line/area with bucketed groupBy)
- "anything weird" / "anomaly" → see anomaly guidance below
- Time phrases: "today" / "yesterday" / "this week" / "last week" / "this month" / "last month" / "this quarter" / "YTD" → derive concrete date ranges from today's date and add a WHERE filter on the table's natural timestamp column (placed_at, created_at, occurred_at, etc.)

Rules:
- Every queryPlan you emit MUST set dataSourceId to "${dataSourceId}" and "model" to one of the table names above.
- Use ONLY the column names listed above. Do not invent columns. Column names are case-sensitive.
- A queryPlan has shape:
  { dataSourceId, model, schema?, joins?, select?, where?, groupBy?, measures?, orderBy?, take?, skip? }
- joins: optional. Use when the answer needs columns from a related table (e.g. "revenue per customer" needs orders + customers). Shape:
  joins: [{ model, type?: 'inner'|'left', on: { from: '<col on base or prior join>', to: '<col on joined table>' }, alias?: string }]
  Every join's (on.from, on.to) MUST correspond to one of the FK relationships listed above (direction-insensitive). The executor rejects unknown edges.
  Column refs anywhere in the plan can be bare ("amount") or qualified ("orders.amount"); qualify when the same name exists on more than one table.

Example: top 5 customers by total order amount
  {
    "model": "customers",
    "joins": [{ "model": "orders", "on": { "from": "customers.id", "to": "orders.customer_id" } }],
    "groupBy": [{ "column": "customers.name", "alias": "label" }],
    "measures": [{ "column": "orders.amount", "op": "sum", "alias": "value" }],
    "orderBy": [{ "column": "value", "dir": "desc" }],
    "take": 5
  }
- For aggregations use measures: [{ column, op, alias? }] where op is one of: count | count_distinct | sum | avg | min | max. For count(*), use column "*".
- REQUIRED for bar / pie charts: ALWAYS include groupBy with the category column aliased "label", AND a measure aliased "value". Without groupBy the chart renders a single undifferentiated slice — always wrong. Example for "orders by status":
    groupBy: [{ "column": "status", "alias": "label" }]
    measures: [{ "column": "*", "op": "count", "alias": "value" }]
    orderBy: [{ "column": "value", "dir": "desc" }], take: 10
- For line / area charts on a time axis, use groupBy: [{ column: 'time_col', alias: 'x', bucket: 'day' | 'week' | 'month' | ... }] and aggregate y in measures (alias 'y').
- For "metric over time split by X" prompts (two-dimensional time-series — e.g. "daily revenue split by segment"), use TWO groupBy entries on a LINE or AREA chart. Bar and pie are single-series only and cannot show a second dimension.
    groupBy: [
      { column: 'time_col', alias: 'x', bucket: 'day' | 'week' | 'month' },
      { column: 'split_dim', alias: 'series' }
    ]
    measures: [{ column: '<num>', op: 'sum', alias: 'y' }]
  Renders as a multi-series line chart (one line per series value).
- For "metric by X by Y" prompts on BAR/PIE (e.g. "revenue by country by segment"): bar/pie only render ONE dimension. Either pick the more important dimension as a single groupBy, OR switch to a line/area chart with the two-dim time-series pattern above, OR emit two separate bar tiles (one per X value of the secondary dim) if both dimensions are needed.
- For scatter charts: emit two measures aliased "x" (first numeric dimension) and "y" (second numeric dimension). Add a groupBy (aliased "series") for the color/group dimension if the user specifies one.
- For kpi (single number): no groupBy. One measure aliased "value".
- For kpi_compare: no groupBy. TWO measures: one aliased "current" (the present-period value) and one aliased "previous" (the prior-period value). Scope each measure to its period using the per-measure "filter" field (NOT the plan-level "where", which would scope BOTH measures the same way and produce identical numbers). Example for "Revenue: this month vs last month" with today = ${today}:
  {
    "model": "orders",
    "measures": [
      {
        "column": "total_amount",
        "op": "sum",
        "alias": "current",
        "filter": { "filter": { "column": "placed_at", "op": "gte", "value": "<start of this month, ISO date>" } }
      },
      {
        "column": "total_amount",
        "op": "sum",
        "alias": "previous",
        "filter": {
          "AND": [
            { "filter": { "column": "placed_at", "op": "gte", "value": "<start of last month, ISO date>" } },
            { "filter": { "column": "placed_at", "op": "lt",  "value": "<start of this month, ISO date>" } }
          ]
        }
      }
    ]
  }
  Per-measure "filter" has the same recursive WhereClause shape as the plan-level "where" (AND / OR / NOT / filter leaf). Same operators (equals, in, gte, lt, etc.). Postgres compiles this to FILTER (WHERE …); ClickHouse to sumIf/countIf/etc.
- For table component: use select [...] without groupBy / measures. Set take to a reasonable page size (50–200).

Sorting:
- orderBy is an array of { column, dir }. column may reference a real column on the model OR an alias from groupBy/measures/select.
- For "top N by X" prompts always use orderBy: [{ column: 'value', dir: 'desc' }] + take: N. ("top 5 countries by revenue" → take: 5)
- For "recent N" on tables, orderBy by the timestamp column descending + take: N.

Filtering (where):
- "where" is a recursive clause. Leaves are { filter: { column, op, value? } }. Logical groups are { AND: [...] } / { OR: [...] } / { NOT: clause }.
- Operator names: equals, not, in, notIn, gt, gte, lt, lte, contains, startsWith, endsWith, isNull, notNull.
- Examples:
  - status = 'open':                  { filter: { column: 'status', op: 'equals', value: 'open' } }
  - status in (open, pending):        { filter: { column: 'status', op: 'in', value: ['open','pending'] } }
  - country=US AND amount>=100:       { AND: [
      { filter: { column: 'country', op: 'equals', value: 'US' } },
      { filter: { column: 'amount',  op: 'gte',   value: 100 } }
    ]}
  - title contains 'urgent':          { filter: { column: 'title', op: 'contains', value: 'urgent' } }
  - response_minutes IS NULL:         { filter: { column: 'response_minutes', op: 'isNull' } }
- Apply filters whenever the user's prompt narrows the scope ("only open tickets", "this year", "for country=US", "amount > 100", "exclude refunds"). Do NOT invent filters the user didn't request.

Pagination: take limits row count; skip offsets. Use take to enforce "top 5", "first 20", etc. Use skip rarely (only if user explicitly asks for a page).

Each component has a "visualType" field. Pick exactly one of these values (use the EXACT uppercase token):
- KPI            — single big number
- KPI_COMPARE    — two periods, one delta
- BAR_CHART      — compare categories
- PIE_CHART      — share of total
- LINE_CHART     — trend over time
- AREA_CHART     — filled trend over time
- SCATTER_CHART  — x/y correlation
- DATA_TABLE     — raw rows

Component sizing (12-column grid, row height = 96px). When you emit a position, pick a size from this table so tiles look right out of the box. The user can drag/resize after.
- kpi / kpi_compare: { w: 3, h: 2 } — single number; narrow + short.
- bar / pie:         { w: 6, h: 4 } — half-width, 4 rows tall.
- line / area:       { w: 8, h: 4 } — wide, 4 rows tall (time-series needs room).
- scatter:           { w: 6, h: 4 }.
- table:             { w: 12, h: 5 } — full width, 5 rows tall so users see ~10 rows without scrolling.

Layout: pack KPI tiles in a single top row (x: 0, 3, 6, 9, all y: 0, w: 3). Charts go below (y: 2 if KPIs are present, else y: 0). Tables go at the bottom on their own row (full width). Don't overlap.

componentConfig.timeColumn (REQUIRED on most tiles — this is how the dashboard's time-range picker filters data):
- DEFAULT BEHAVIOR: every tile whose base model has a temporal column MUST include componentConfig: { timeColumn: "<that column>" }. Without it the tile silently ignores the dashboard time-range picker, which users almost always notice and call out.
- Pick the most natural temporal column on the base model — usually the one that says "when this row happened" (placed_at, created_at, occurred_at, started_at, signed_up_at, etc.). For line/area charts, use the same column as your time-axis groupBy.
- Always set it when:
  - the chart is line / area (time-series),
  - the user mentions "recent", "trend", "last N days", "this quarter", or anything time-scoped,
  - the tile is a KPI / bar / pie / table on an event-shaped table (orders, events, sessions, tickets, etc.).

Use the BARE column name when it lives on the base model:
  Example — Total Orders KPI, model: "orders" →
    componentConfig: { timeColumn: "placed_at" }

Use the QUALIFIED form when it lives on a JOINED table, and include that table in joins:
  Example — Total Revenue on order_items needs to be filterable by order date:
    model: "order_items"
    joins: [{ model: "orders", on: { from: "order_items.order_id", to: "orders.id" } }]
    componentConfig: { timeColumn: "orders.placed_at" }

Only OMIT componentConfig when the base model genuinely has no temporal column AND adding a join just to get one would distort the query (e.g. a pure lookup table like categories that the user wouldn't expect to be time-scoped).

Full add_component example (for "Total Orders KPI" on the ecommerce schema):
{
  "visualType": "KPI",
  "title": "Total Orders",
  "queryPlan": {
    "dataSourceId": "<from system prompt>",
    "model": "orders",
    "measures": [{ "column": "id", "op": "count", "alias": "value" }]
  },
  "position": { "x": 0, "y": 0, "w": 3, "h": 2 },
  "componentConfig": { "timeColumn": "placed_at" }
}

Note the componentConfig at the same level as queryPlan/position — NOT inside queryPlan. Including it lets the dashboard time-range picker filter this tile.

IMPORTANT: Emit ALL tool calls you need in a single response. Do not stop after one tool call to wait for a result — the user-facing system applies these tool calls client-side and there is nothing to wait for. A useful dashboard requires set_dashboard_meta PLUS multiple add_component calls (typically 2–5 components) in the same turn.

Workflow on a fresh dashboard, all in one response:
1. set_dashboard_meta with a clear title (and optional description).
2. add_component, add_component, add_component, ... — usually 2 to 5 calls.
3. A short prose explanation is welcome; keep it brief.

When iterating on an existing draft, use update_component (referencing the component's id from the plan you receive) and remove_component as needed.

When you CANNOT build what the user asked for — the table or column they named doesn't exist on this source — do NOT write a long prose apology with markdown bullet points. Call the suggest_components tool instead: a short plain-language message (one or two sentences, no markdown) explaining what's missing, plus 2–4 concrete alternative prompts that DO map to tables/columns listed above. Each suggestion's "prompt" must be a complete instruction the user could re-run as-is. Only fall back to plain prose if no sensible alternative exists at all.

Do not output raw queryPlan JSON in prose — emit it only via tool_calls. Keep narration concise.`;
}

export function buildUserMessage(
  prompt: string,
  currentPlan?: DashboardPlan,
  lastError?: string,
): string {
  const errorBlock = lastError
    ? `Previous attempt failed at execution. Error:
${lastError.slice(0, 500)}

Please correct the queryPlan and retry. Common fixes:
- Type mismatch in JOIN: pick two columns of the same data type (don't join text to number / date to number).
- Missing column / table: re-read the schema list above; use ONLY listed names.
- Empty result: relax filters or pick a different time range.

`
    : '';

  if (!currentPlan || currentPlan.components.length === 0) {
    return `${errorBlock}${prompt}`;
  }
  const componentSummary = currentPlan.components
    .map(
      (c, i) =>
        `  ${i + 1}. id=${c.id} type=${c.visualType} title="${c.title}" model=${c.queryPlan.model}`,
    )
    .join('\n');
  return `${errorBlock}Current draft dashboard:
title: ${currentPlan.title ?? '(unset)'}
description: ${currentPlan.description ?? '(unset)'}
components:
${componentSummary}

User's follow-up: ${prompt}`;
}
