import { type DashboardPlan } from '@xyne/shared';
import { config } from '@/config/env';
import { ColumnSummaryCodec } from '@/types/dataSource';

// Model-facing renderers for the dashboard-ai agent: schema/table/relationship
// lines (used by the DashboardClawController tool endpoints) and the per-turn
// dashboard context block (used by the aiCreate SSE proxy).

function sanitizeForPrompt(s: string, maxLen = 120): string {
  return s.replace(/[^A-Za-z0-9 _.\-/]/g, '_').slice(0, maxLen);
}

export function sanitizeDescriptionForPrompt(s: string, maxLen: number): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9 _.\-/:,;()%'+&?!=]/g, '_')
    .trim()
    .slice(0, maxLen);
}

function compactNumber(n: number | bigint | null | undefined): string | null {
  if (n == null) return null;
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return `${(v / 1000).toFixed(1)}K`;
  if (v < 1_000_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  return `${(v / 1_000_000_000).toFixed(1)}B`;
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
    if (
      parsed.valuesAreExhaustive &&
      distinct <= config.dashboard.aiTopValuesInlineLimit &&
      parsed.topValues
    ) {
      const vals = parsed.topValues
        .map((v) => sanitizeForPrompt(String(v.value), 40))
        .slice(0, config.dashboard.aiTopValuesInlineLimit)
        .join(', ');
      parts.push(`distinct=${distinct}, values: ${vals}`);
    } else {
      parts.push(`~${distinct} distinct`);
    }
  }
  if (parsed.numericStats) {
    const { min, max } = parsed.numericStats;
    const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    parts.push(`range ${fmt(min)}..${fmt(max)}`);
  }
  if (parsed.temporalStats) {
    parts.push(
      `${parsed.temporalStats.min.slice(0, 10)}..${parsed.temporalStats.max.slice(0, 10)}`,
    );
  }
  if (
    parsed.sampleValues &&
    parsed.sampleValues.length > 0 &&
    !(parsed.valuesAreExhaustive && parsed.topValues)
  ) {
    const samples = parsed.sampleValues
      .slice(0, 2)
      .map((v) => sanitizeForPrompt(v, 30))
      .join(' | ');
    parts.push(`e.g. ${samples}`);
  }
  if (
    typeof parsed.nullCount === 'number' &&
    typeof parsed.totalCount === 'number' &&
    parsed.totalCount > 0 &&
    parsed.nullCount / parsed.totalCount >= 0.5
  ) {
    parts.push(`null%${Math.round((parsed.nullCount / parsed.totalCount) * 100)}`);
  }
  return parts.length > 0 ? `${dt} [${parts.join('; ')}]` : dt;
}

export function renderTableLine(t: {
  schemaName: string;
  tableName: string;
  rowCountEstimate?: bigint | null;
  description?: string | null;
  columns: ReadonlyArray<{
    columnName: string;
    dataTypeCanonical: string | null;
    summary?: string | null;
  }>;
}): string {
  const schemaName = sanitizeForPrompt(t.schemaName, 63);
  const tableName = sanitizeForPrompt(t.tableName, 63);
  const rows = compactNumber(t.rowCountEstimate ?? null);
  const desc = t.description ? ` — ${sanitizeDescriptionForPrompt(t.description, 280)}` : '';
  const cols = t.columns
    .map(
      (c) =>
        `${sanitizeForPrompt(c.columnName, 63)}:${renderColumnHints(c.dataTypeCanonical, c.summary)}`,
    )
    .join(', ');
  return `- ${schemaName}.${tableName}${rows ? ` [~${rows} rows]` : ''}${desc} (${cols})`;
}

interface RenderableRelationship {
  cardinality: string;
  fromColumn: { columnName: string; table: { schemaName: string; tableName: string } };
  toColumn: { columnName: string; table: { schemaName: string; tableName: string } };
}

export function renderRelationshipLine(r: RenderableRelationship): string {
  const side = (c: RenderableRelationship['fromColumn']): string =>
    `${sanitizeForPrompt(c.table.schemaName, 63)}.${sanitizeForPrompt(c.table.tableName, 63)}.${sanitizeForPrompt(c.columnName, 63)}`;
  const card = r.cardinality === 'one_to_one' ? 'one-to-one' : 'many-to-one';
  return `- ${side(r.fromColumn)} → ${side(r.toColumn)} (${card})`;
}

export function renderTableIndexLine(t: {
  schemaName: string;
  tableName: string;
  rowCountEstimate: bigint | null;
  columnCount: number;
}): string {
  const rows = compactNumber(t.rowCountEstimate) ?? '?';
  return `- ${sanitizeForPrompt(t.schemaName, 63)}.${sanitizeForPrompt(t.tableName, 63)} (~${rows} rows, ${t.columnCount} cols)`;
}

export function buildDashboardContext(args: {
  dataSourceName: string;
  sourceType: string;
  tables: ReadonlyArray<{
    schemaName: string;
    tableName: string;
    rowCountEstimate: bigint | null;
    description: string | null;
    columns: ReadonlyArray<{
      columnName: string;
      dataTypeCanonical: string | null;
      summary: string | null;
    }>;
  }>;
  relationships: ReadonlyArray<{
    cardinality: string;
    fromColumn: { columnName: string; table: { schemaName: string; tableName: string } };
    toColumn: { columnName: string; table: { schemaName: string; tableName: string } };
  }>;
  currentPlan: DashboardPlan | undefined;
  focusedComponentId: string | undefined;
}): string {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

  const parts: string[] = [
    `Today's date is ${today} (${dayOfWeek}, timezone UTC). Use it to anchor relative time phrases ("this week", "last month", "YTD").`,
    `Selected data source: ${args.dataSourceName} (type: ${args.sourceType}). Its introspected tables and columns:`,
    args.tables.map(renderTableLine).join('\n') || '(no introspected tables yet)',
  ];
  if (args.relationships.length > 0) {
    parts.push(
      `Introspected relationships (join hints — you are NOT limited to these):\n${args.relationships
        .map(renderRelationshipLine)
        .join('\n')}`,
    );
  }
  const plan = args.currentPlan;
  if (plan && plan.components.length > 0) {
    const componentSummary = plan.components
      .map((c, i) => {
        const qp = c.queryPlan as { model?: unknown };
        const base = `  ${i + 1}. id=${c.id} type=${c.visualType} title="${c.title}" model=${qp.model}`;
        if (c.id !== args.focusedComponentId) return base;
        const planForPrompt = { ...(c.queryPlan as Record<string, unknown>) };
        delete planForPrompt['dataSourceId'];
        return `${base}  <-- FOCUSED: the user's request refers to THIS tile (its full spec is below; reuse it verbatim when editing)\n       query: ${JSON.stringify(planForPrompt)}`;
      })
      .join('\n');
    parts.push(
      `Current dashboard state:\ntitle: ${plan.title ?? '(unset)'}\ndescription: ${plan.description ?? '(unset)'}\ncomponents:\n${componentSummary}`,
    );
  } else {
    parts.push('Current dashboard state: empty (no components yet).');
  }
  return parts.join('\n\n');
}
