import type { ReactNode } from 'react';
import type { ComponentDef, Registry } from './types.js';
import { DisplayValue, isAttachment, isAttachmentArray } from '../components/shared/AttachmentCard.js';
import { MarkdownView } from '../components/shared/MarkdownView.js';
import { CitationMarks, CitationList, CitationChips } from '../components/shared/CitationArrow.js';
import { isCitationRefArray, citeAt } from '../components/shared/citation.js';
import { cn } from '../components/shared/cn.js';
import {
  Area,
  AreaChart as RAreaChart,
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartPoints, resolveChart } from './chart-data.js';

/**
 * The whitelisted layout components a template may use. Structure only — every
 * visual style is baked here (on --wui tokens), so a template never carries CSS.
 */

const str = (v: unknown): string | undefined => (v == null ? undefined : String(v));
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};
// A template may write horizontal, horizontal="true" or horizontal={true}; the
// parser yields true, a string, or a boolean respectively.
const bool = (v: unknown): boolean | undefined => {
  if (v == null) return undefined;
  if (typeof v === 'boolean') return v;
  const t = String(v).toLowerCase();
  return t === 'true' || t === '' ? true : t === 'false' ? false : undefined;
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !isAttachment(v) && !isAttachmentArray(v);
// A node's `citations` prop chooses how a cited value shows its sources: a
// detailed list below the value ('below'), a compact chip strip ('list'), or
// (default) the inline chip + hover popover.
const citePlacementOf = (p: Record<string, unknown>): 'below' | 'list' | undefined => {
  const c = str(p['citations']);
  return c === 'below' || c === 'list' ? c : undefined;
};
function humanize(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Value — the smart auto-renderer used everywhere a raw value lands ───
//
// A `cite` prop carries the branch of the citation mirror matching the value
// being rendered, so containers walk both with the same key/index and every leaf
// finds its own sources. `isCitationRefArray` is what tells a leaf (`[{kind…}]`)
// from a branch (`[{amount:[…]}]`) — only leaves carry `kind`.

function ValueView({ value, cite, citePlacement }: { value: unknown; cite?: unknown; citePlacement?: 'below' | 'list' | undefined }): ReactNode {
  const leaf = isCitationRefArray(cite) ? cite : undefined;
  // How a value's sources render: a detailed list below the value ('below'), a
  // compact chip strip ('list'), or (default) the inline chip + hover popover —
  // so a cited number reads as "5,000 ↗" rather than gaining a whole row.
  const mark = (node: ReactNode): ReactNode => {
    if (!leaf) return node;
    if (citePlacement === 'below') return <div className="flex flex-col">{node}<CitationList refs={leaf} /></div>;
    if (citePlacement === 'list') return <div className="flex flex-col">{node}<CitationChips refs={leaf} /></div>;
    return <span className="inline-flex items-baseline gap-1">{node}<CitationMarks refs={leaf} /></span>;
  };

  if (value === null || value === undefined || value === '') return mark(<span className="text-[var(--wui-fg-muted)]">—</span>);
  if (typeof value === 'boolean') return mark(<span className="font-medium text-[var(--wui-fg)]">{value ? 'Yes' : 'No'}</span>);
  if (typeof value === 'number') return mark(<span className="font-medium tabular-nums text-[var(--wui-fg)]">{value.toLocaleString()}</span>);
  if (isAttachment(value) || isAttachmentArray(value)) return mark(<DisplayValue value={value} />);
  if (Array.isArray(value)) {
    if (value.length === 0) return mark(<span className="text-[var(--wui-fg-muted)]">None</span>);
    if (value.every((v) => !isObj(v) && !Array.isArray(v))) {
      const items = value.map((v) => String(v));
      const itemLeaf = (i: number) => {
        const c = citeAt(cite, i);
        return isCitationRefArray(c) ? c : undefined;
      };
      // Short scalars → tag chips; sentence-length strings → a readable bulleted list
      // (a long sentence stuffed into a chip looks wrong).
      if (items.every((s) => s.length <= 24)) {
        return mark(<div className="flex flex-wrap gap-1.5">{items.map((s, i) => { const l = itemLeaf(i); return <span key={i} className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--wui-fg)_6%,transparent)] px-2 py-0.5 text-[12px] text-[var(--wui-fg)]">{s}{l && <CitationMarks refs={l} />}</span>; })}</div>);
      }
      return mark(<ul className="flex flex-col gap-1.5">{items.map((s, i) => { const l = itemLeaf(i); return <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-[var(--wui-fg)]"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--wui-fg-muted)]" /><span className="inline-flex items-baseline gap-1 flex-wrap">{s}{l && <CitationMarks refs={l} />}</span></li>; })}</ul>);
    }
    return <div className="flex flex-col gap-2">{value.map((v, i) => <div key={i} className="rounded-lg border border-[var(--wui-border)] p-3">{isObj(v) ? <KV data={v} dense cite={citeAt(cite, i)} /> : <ValueView value={v} cite={citeAt(cite, i)} citePlacement={citePlacement} />}</div>)}</div>;
  }
  if (isObj(value)) return <div className="rounded-lg border border-[var(--wui-border)] p-3"><KV data={value} dense cite={cite} /></div>;
  const s = String(value);
  if (s.length > 100 || s.includes('\n')) return mark(<MarkdownView className="text-[13px] text-[var(--wui-fg)]">{s}</MarkdownView>);
  return mark(<span className="text-[var(--wui-fg)]">{s}</span>);
}

// ─── Grid — label→value from an object ───

function KV({ data, dense, cite }: { data: unknown; dense?: boolean; cite?: unknown }) {
  const entries = isObj(data) ? Object.entries(data) : [];
  if (entries.length === 0) return <div className="text-[13px] italic text-[var(--wui-fg-muted)]">No fields</div>;
  if (dense) {
    return (
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">{humanize(k)}</span>
            <div className="min-w-0 text-[13px]"><ValueView value={v} cite={citeAt(cite, k)} /></div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex min-w-0 gap-4">
          <span className="w-40 shrink-0 pt-0.5 text-left text-[12px] font-semibold text-[var(--wui-fg)]">{humanize(k)}</span>
          <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed"><ValueView value={v} cite={citeAt(cite, k)} /></div>
        </div>
      ))}
    </div>
  );
}

// ─── Code ───

function CodeBlock({ lang, children }: { lang?: string | undefined; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--wui-border)]">
      {lang && <div className="border-b border-[var(--wui-border)] bg-[color-mix(in_srgb,var(--wui-fg)_3%,transparent)] px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--wui-fg-muted)]">{lang}</div>}
      <pre className="overflow-auto p-3 text-[12.5px] leading-relaxed text-[var(--wui-fg)]"><code className="whitespace-pre font-mono">{children}</code></pre>
    </div>
  );
}

// ─── Json ───

function JsonView({ data }: { data: unknown }) {
  let text: string;
  try { text = JSON.stringify(data, null, 2) ?? String(data); } catch { text = String(data); }
  return <pre className="overflow-auto rounded-lg border border-[var(--wui-border)] bg-[color-mix(in_srgb,var(--wui-fg)_2%,transparent)] p-3 text-[12px] leading-relaxed text-[var(--wui-fg)]"><code className="whitespace-pre font-mono">{text}</code></pre>;
}

// ─── Table ───

function TableView({ data, cite }: { data: unknown; cite?: unknown }) {
  // Carry each row's original index: the citation branch is indexed against the
  // source array, so filtering out a non-record row would otherwise shift every
  // subsequent row's citations onto the wrong data.
  const rows = (Array.isArray(data) ? data : [])
    .map((r, i) => ({ r, i }))
    .filter((x): x is { r: Record<string, unknown>; i: number } => isObj(x.r));
  if (rows.length === 0) return <div className="text-[13px] italic text-[var(--wui-fg-muted)]">No rows</div>;
  const cols = [...new Set(rows.flatMap(({ r }) => Object.keys(r)))];
  // GitHub-style tables — mirrors MarkdownView: rounded bordered frame, filled header,
  // column gridlines, zebra rows. Kept in sync so config <Table> and markdown tables match.
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--wui-border)]">
      <table className="w-full border-collapse text-[12px] [&_tbody_tr:nth-child(2n)]:bg-[color-mix(in_srgb,var(--wui-fg)_4%,transparent)] [&_tbody_tr:last-child_td]:border-b-0">
        <thead>
          <tr>
            {cols.map((c) => <th key={c} className="border-b border-[var(--wui-border)] bg-[var(--wui-bg-muted)] px-3 py-2 text-left font-semibold text-[var(--wui-fg)] [&:not(:last-child)]:border-r [&:not(:last-child)]:border-[var(--wui-border)]">{humanize(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, i }) => {
            const rowCite = citeAt(cite, i);
            const rowLeaf = isCitationRefArray(rowCite) ? rowCite : undefined;
            return (
            <tr key={i}>
              {cols.map((c, ci) => <td key={c} className="border-b border-[var(--wui-border)] px-3 py-2 align-top text-[var(--wui-fg)] [&:not(:last-child)]:border-r [&:not(:last-child)]:border-[var(--wui-border)]"><ValueView value={r[c]} cite={rowLeaf ? undefined : citeAt(rowCite, c)} />{rowLeaf && ci === 0 && <span className="ml-1 inline-flex align-baseline"><CitationMarks refs={rowLeaf} /></span>}</td>)}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Matrix — pivot [{label, values:{col:val}}] into label-rows × value-columns ───
// For metric/period tables (financials): each row is a metric, columns are the periods
// (union of the values-object keys). Same GitHub-style frame as Table; numeric cells right-aligned.

function MatrixView({ data, rowKey, sub, values, cite }: { data: unknown; rowKey?: string | undefined; sub?: string | undefined; values?: string | undefined; cite?: unknown }) {
  const rows = (Array.isArray(data) ? data : [])
    .map((r, i) => ({ r, i }))
    .filter((x): x is { r: Record<string, unknown>; i: number } => isObj(x.r));
  if (rows.length === 0) return <div className="text-[13px] italic text-[var(--wui-fg-muted)]">No rows</div>;
  const rk = rowKey ?? 'label';
  const vk = values ?? 'values';
  const cols: string[] = [];
  for (const { r } of rows) { const v = r[vk]; if (isObj(v)) for (const k of Object.keys(v)) if (!cols.includes(k)) cols.push(k); }
  const th = 'border-b border-[var(--wui-border)] bg-[var(--wui-bg-muted)] px-3 py-2 font-semibold text-[var(--wui-fg)] [&:not(:last-child)]:border-r [&:not(:last-child)]:border-[var(--wui-border)]';
  const td = 'border-b border-[var(--wui-border)] px-3 py-2 align-top [&:not(:last-child)]:border-r [&:not(:last-child)]:border-[var(--wui-border)]';
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--wui-border)]">
      <table className="w-full border-collapse text-[12px] [&_tbody_tr:nth-child(2n)]:bg-[color-mix(in_srgb,var(--wui-fg)_4%,transparent)] [&_tbody_tr:last-child_td]:border-b-0">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>{humanize(rk)}</th>
            {cols.map((c) => <th key={c} className={cn(th, 'whitespace-nowrap text-right')}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, i }) => {
            const v = isObj(r[vk]) ? (r[vk] as Record<string, unknown>) : {};
            const subLabel = sub ? str(r[sub]) : undefined;
            // Cells live at `<row>.<valuesKey>.<col>`, so the citation branch is
            // indexed the same way.
            const rowCite = citeAt(citeAt(cite, i), vk);
            return (
              <tr key={i}>
                <td className={cn(td, 'text-left')}>
                  <span className="font-medium text-[var(--wui-fg)]">{str(r[rk]) ?? ''}</span>
                  {subLabel ? <span className="ml-1.5 text-[11px] text-[var(--wui-fg-muted)]">{subLabel}</span> : null}
                </td>
                {cols.map((c) => <td key={c} className={cn(td, 'text-right tabular-nums text-[var(--wui-fg)]')}><ValueView value={v[c]} cite={citeAt(rowCite, c)} /></td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Preview — a document / image with sizing ───

function PreviewView({ src, height, width }: { src: unknown; height?: number | undefined; width?: number | undefined }) {
  // Attachment(s) → the app's document card (click it to open the full preview).
  if (isAttachment(src) || isAttachmentArray(src)) return <DisplayValue value={src} />;
  const url = typeof src === 'string' ? src : undefined;
  if (url && /^(https?:|data:image|blob:)/.test(url)) {
    return <img src={url} alt="preview" className="rounded-lg border border-[var(--wui-border)] object-contain" style={{ height, width, maxWidth: '100%' }} />;
  }
  return <div className="rounded-lg border border-dashed border-[var(--wui-border)] p-4 text-[13px] text-[var(--wui-fg-muted)]">No preview available</div>;
}

// ─── Chart — one series over a category axis ───
//
// Colours and structure come from --wui tokens so the chart follows the host's
// theme. Do NOT reach for the --wui-cat-*-light tints here: the host never
// redefines them, so they stay near-white and the chart breaks in dark mode.
//
// ResponsiveContainer is required rather than a fixed width: the execution
// panel sits beside a user-resizable, collapsible sidebar, so the available
// width changes at runtime.
type ChartKind = 'bar' | 'line' | 'area';

function ChartView({ data, x, y, height, horizontal, kind }: {
  data: unknown;
  x?: string | undefined;
  y?: string | undefined;
  height?: number | undefined;
  horizontal?: boolean | undefined;
  kind: ChartKind;
}) {
  const resolved = resolveChart(data, x, y);
  // Guarded before the container so the message is visible (and assertable) —
  // ResponsiveContainer renders nothing until it has measured a size.
  if (!resolved.ok) {
    return <div className="text-[13px] italic text-[var(--wui-fg-muted)]">{resolved.message}</div>;
  }
  const points = chartPoints(resolved.rows, resolved.xKey, resolved.yKey);
  const label = humanize(resolved.yKey);
  // Long category labels need horizontal bars. Default from the data rather
  // than making every funnel pass a prop.
  const longest = points.reduce((m, pt) => Math.max(m, pt.label.length), 0);
  // Cap the category gutter so the bars keep most of a narrow panel, and clip
  // the label to fit rather than letting recharts cut it mid-glyph. The full
  // text stays available in the tooltip.
  const MAX_LABEL = 24;
  const clip = (v: unknown): string => {
    const t = String(v);
    return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL - 1)}\u2026` : t;
  };
  const gutter = Math.min(175, Math.max(80, Math.min(longest, MAX_LABEL) * 7.2));
  const flip = horizontal ?? (longest > 14 || points.length > 6);
  const h = height ?? (flip ? Math.max(140, points.length * 28 + 40) : 220);
  // 12px to match the surrounding layout components (Table is text-[12px]); the
  // analytics dashboard's 10px reads as a different typeface next to them.
  // fontFamily is set explicitly because SVG <text> falls back to the browser's
  // default serif wherever the inherited font doesn't reach it.
  const axisTick = { fontSize: 12, fill: 'var(--wui-fg-muted)', fontFamily: 'inherit' } as const;
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="var(--wui-border)" vertical={flip} horizontal={!flip} />;
  const tip = (
    <Tooltip
      cursor={{ fill: 'color-mix(in srgb, var(--wui-fg) 6%, transparent)' }}
      formatter={(v: unknown) => [v as number, label]}
      labelFormatter={(l: unknown) => String(l)}
      contentStyle={{ fontSize: 12, fontFamily: 'inherit', background: 'var(--wui-bg)', border: '1px solid var(--wui-border)', borderRadius: 6 }}
    />
  );
  // A category axis of labels and a numeric axis of values, swapped when flipped.
  const cat = <XAxis type="category" dataKey="label" tick={axisTick} axisLine={{ stroke: 'var(--wui-border)' }} tickLine={false} interval={0} tickFormatter={clip} />;
  const val = <YAxis type="number" allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />;
  const catV = <YAxis type="category" dataKey="label" tick={axisTick} axisLine={{ stroke: 'var(--wui-border)' }} tickLine={false} width={gutter} tickFormatter={clip} interval={0} />;
  const valH = <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={{ stroke: 'var(--wui-border)' }} tickLine={false} />;
  const margin = flip ? { top: 4, right: 16, left: 0, bottom: 4 } : { top: 4, right: 8, left: -16, bottom: 0 };
  const fill = 'var(--wui-primary)';

  const body =
    kind === 'bar' ? (
      <RBarChart data={points} layout={flip ? 'vertical' : 'horizontal'} margin={margin}>
        {grid}{flip ? valH : cat}{flip ? catV : val}{tip}
        <Bar dataKey="value" name={label} fill={fill} radius={flip ? [0, 3, 3, 0] : [3, 3, 0, 0]} />
      </RBarChart>
    ) : kind === 'line' ? (
      <RLineChart data={points} margin={margin}>
        {grid}{cat}{val}{tip}
        <Line type="monotone" dataKey="value" name={label} stroke={fill} strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} />
      </RLineChart>
    ) : (
      <RAreaChart data={points} margin={margin}>
        {grid}{cat}{val}{tip}
        <Area type="monotone" dataKey="value" name={label} stroke={fill} strokeWidth={2} fill={fill} fillOpacity={0.15} connectNulls={false} />
      </RAreaChart>
    );

  // min-w-0 because Row's flex-wrap variant does not set it on children, and a
  // ResponsiveContainer in a flex row without it refuses to shrink.
  return (
    <div className="min-w-0 w-full font-sans" aria-label={label} style={{ width: '100%', height: h }}>
      <ResponsiveContainer width="100%" height="100%">{body}</ResponsiveContainer>
    </div>
  );
}

// ─── Registry ───

const section: ComponentDef = {
  childMode: 'nodes',
  render: (props, kids, key) => (
    <section key={key} className="flex flex-col">
      {props['title'] != null && (
        <div className="mb-3 flex items-center gap-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--wui-primary)]">{str(props['title'])}</h3>
          <span className="h-px flex-1 bg-[color-mix(in_srgb,var(--wui-primary)_25%,transparent)]" />
        </div>
      )}
      <div className="flex flex-col gap-4">{kids}</div>
    </section>
  ),
};

export const DEFAULT_REGISTRY: Registry = {
  Section: section,
  Row: {
    childMode: 'nodes',
    render: (p, kids, key) => {
      const cols = num(p['cols']);
      if (cols && cols > 1) return <div key={key} className="grid gap-x-8 gap-y-2.5" style={{ gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))` }}>{kids}</div>;
      return <div key={key} className="flex flex-wrap items-start gap-x-10 gap-y-4">{kids}</div>;
    },
  },
  Col: { childMode: 'nodes', render: (p, kids, key) => <div key={key} className="flex min-w-0 flex-1 flex-col gap-4" style={{ gap: num(p['gap']) }}>{kids}</div> },
  Field: {
    childMode: 'nodes',
    render: (p, kids, key) => {
      const body = 'value' in p ? <ValueView value={p['value']} cite={p['cite']} citePlacement={citePlacementOf(p)} /> : kids;
      if (p['stacked']) {
        return (
          <div key={key} className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--wui-fg)]">{str(p['label'])}</span>
            <div className="min-w-0 text-[13.5px] leading-relaxed text-[var(--wui-fg)]">{body}</div>
          </div>
        );
      }
      return (
        <div key={key} className="flex min-w-0 gap-4">
          <span className="w-40 shrink-0 pt-0.5 text-left text-[12px] font-semibold text-[var(--wui-fg)]">{str(p['label'])}</span>
          <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed">{body}</div>
        </div>
      );
    },
  },
  Link: {
    childMode: 'text',
    render: (p, kids, key) => {
      const text = str(p['label']) ?? (typeof kids === 'string' ? kids : '') ?? '';
      const href = str(p['href']) ?? text;
      return href
        ? <a key={key} href={href} target="_blank" rel="noreferrer" className="text-[var(--wui-primary)] underline underline-offset-2 hover:opacity-80">{text || href}</a>
        : <span key={key} className="text-[var(--wui-fg-muted)]">—</span>;
    },
  },
  Grid: { childMode: 'none', render: (p, _k, key) => <div key={key}><KV data={p['data']} cite={p['cite']} /></div> },
  Value: { childMode: 'none', render: (p, _k, key) => <span key={key}><ValueView value={p['value']} cite={p['cite']} citePlacement={citePlacementOf(p)} /></span> },
  Markdown: { childMode: 'text', render: (p, kids, key) => <MarkdownView key={key} className="text-[13.5px] leading-relaxed text-[var(--wui-fg)]">{str(p['value']) ?? (typeof kids === 'string' ? kids : '')}</MarkdownView> },
  Code: { childMode: 'text', render: (p, kids, key) => <CodeBlock key={key} lang={str(p['lang'])}>{str(p['value']) ?? (typeof kids === 'string' ? kids : '')}</CodeBlock> },
  Json: { childMode: 'none', render: (p, _k, key) => <JsonView key={key} data={p['data']} /> },
  Table: { childMode: 'none', render: (p, _k, key) => <TableView key={key} data={p['data']} cite={p['cite']} /> },
  Matrix: { childMode: 'none', render: (p, _k, key) => <MatrixView key={key} data={p['data']} rowKey={str(p['rowKey'])} sub={str(p['sub'])} values={str(p['values'])} cite={p['cite']} /> },
  Preview: { childMode: 'none', render: (p, _k, key) => <PreviewView key={key} src={p['src']} height={num(p['height'])} width={num(p['width'])} /> },
  BarChart: { childMode: 'none', render: (p, _k, key) => <ChartView key={key} kind="bar" data={p['data']} x={str(p['x'])} y={str(p['y'])} height={num(p['height'])} horizontal={bool(p['horizontal'])} /> },
  LineChart: { childMode: 'none', render: (p, _k, key) => <ChartView key={key} kind="line" data={p['data']} x={str(p['x'])} y={str(p['y'])} height={num(p['height'])} /> },
  AreaChart: { childMode: 'none', render: (p, _k, key) => <ChartView key={key} kind="area" data={p['data']} x={str(p['x'])} y={str(p['y'])} height={num(p['height'])} /> },
};

export { cn };
