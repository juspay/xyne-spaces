/**
 * A cited step's recorded output, with the cited field highlighted.
 *
 * The second half of the two-source model: a citation resolves either to a
 * DOCUMENT (open it, anchor inside) or to a STEP OUTPUT (open it, land on the
 * path). Both answer the same question — "show me where this came from" — so a
 * value citation must open something rather than being an inert marker.
 *
 * The highlight is an exact path lookup, not a text search. That makes it the
 * most reliable anchor in the system: a document quote can drift and silently
 * miss, but a path either exists in the recorded output or demonstrably doesn't.
 *
 * The output is what the step ACTUALLY returned in this run — immutable and
 * stored — so unlike a live API there is no snapshot caveat to caption.
 */
import { useEffect, useRef } from 'react';
import { JsonTreeViewer } from './JsonTreeViewer.js';

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

/** The value at `path`, or undefined when the path doesn't exist in this output. */
export function valueAtPath(root: unknown, path: readonly string[]): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (!isObj(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function render(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export interface StepOutputViewProps {
  /** The producing step's recorded output. */
  output: unknown;
  /** Path to the cited field, relative to the output root. */
  path?: readonly string[] | undefined;
  /** The step's configured title — what the reader knows the step as. */
  label: string;
  /**
   * The step's id. Shown alongside the title because they answer different
   * questions: the title says what the step is *for*, the id is what every
   * `{{ref}}` and citation actually names — so a reader cross-checking a ref
   * against the panel needs to see it.
   */
  stepId?: string | undefined;
  /** The step's configured description — why this step exists at all. */
  description?: string | undefined;
}

export function StepOutputView({ output, path, label, stepId, description }: StepOutputViewProps) {
  const citedRef = useRef<HTMLDivElement | null>(null);
  const hasPath = !!path && path.length > 0;
  const cited = hasPath ? valueAtPath(output, path) : undefined;
  // A path that doesn't resolve is stated plainly rather than silently showing
  // the whole output as if it were the citation.
  const missing = hasPath && cited === undefined;

  useEffect(() => {
    citedRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [path]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--wui-bg)]">
      {/* Provenance for data is "which step, which field" — so the header names
          the step the way the author titled it, the id every ref uses, why the
          step exists, and where in its output the value sits. */}
      <div className="shrink-0 border-b border-[var(--wui-border)] px-4 py-2.5">
        <div className="text-[12px] font-semibold text-[var(--wui-fg)]">{label}</div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {stepId !== undefined && (
            <span
              title="Step id — what refs and citations name"
              className="rounded bg-[var(--wui-bg-muted)] px-1.5 py-px font-mono text-[10px] text-[var(--wui-fg-muted)]"
            >
              {stepId}
            </span>
          )}
          {hasPath && (
            <span className="font-mono text-[10.5px] text-[var(--wui-fg-muted)]">
              {path.join('.')}
            </span>
          )}
        </div>

        {description !== undefined && description !== '' && (
          <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--wui-fg-muted)]">
            {description}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {hasPath && !missing && (
          <div ref={citedRef} className="mb-4">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">
              Cited value
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-[color-mix(in_srgb,var(--wui-primary)_35%,transparent)] bg-[color-mix(in_srgb,var(--wui-primary)_10%,transparent)] px-3 py-2 text-[12px] leading-relaxed text-[var(--wui-fg)]">
              {render(cited)}
            </pre>
          </div>
        )}

        {missing && (
          <div className="mb-4 rounded-md border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-3 py-2 text-[12px] text-[var(--wui-fg-muted)]">
            That path isn&rsquo;t present in this step&rsquo;s output — showing the full output instead.
          </div>
        )}

        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">
          Step output
        </div>
        {/* The same tree the graph side panel uses, so a reader who follows a
            citation lands on a rendering they already recognise rather than a
            second presentation of the same data. */}
        <JsonTreeViewer data={output} placeholder="No output recorded for this step" />
      </div>
    </div>
  );
}
