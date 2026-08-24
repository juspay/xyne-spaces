/**
 * Argument usage rendered as the tool schema it describes.
 *
 * The previous table listed fields as rows, which read as "some statistics" and
 * lost the fact that this IS the tool's inputSchema with a usage number
 * attached. Everyone reads tool schemas as indented JSON, so this renders
 * indented JSON — same field order, same required/optional distinction — and
 * hangs the measurement off each line.
 *
 * Colour is deliberately restrained: punctuation and values wear text tokens,
 * and the status palette is spent only on the two findings worth acting on —
 * a declared field the model never supplies, and a field it supplies that the
 * schema never declared. A full syntax theme would spend contrast on quoting.
 *
 * `schemaCovered: false` means no declared schema could be joined (only custom
 * tools expose one by name). The block then renders what was OBSERVED and says
 * so, rather than implying the tool declares exactly these fields.
 */

import { type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { ArgFieldRow, ToolArgUsageRow } from "../../../lib/api";
import { STATUS } from "./metricsPalette";
import { formatCount, formatPct } from "./metricsFormat";

type FieldKind = "required" | "optional" | "dead" | "undeclared";

function kindOf(field: ArgFieldRow, schemaCovered: boolean): FieldKind {
  if (schemaCovered && !field.declared) return "undeclared";
  if (field.callsWithField === 0) return "dead";
  return field.required ? "required" : "optional";
}

const KIND_NOTE: Record<FieldKind, string> = {
  required: "required",
  optional: "optional",
  dead: "declared, never supplied",
  undeclared: "supplied but not declared",
};

const KIND_COLOR: Partial<Record<FieldKind, string>> = {
  dead: STATUS.warning,
  undeclared: STATUS.serious,
};

/**
 * Pre-renders each field line as plain text so the trailing `//` comments can be
 * aligned to a single column.
 *
 * Padding off the key length alone is not enough — the supplied percentage and
 * the call count both vary in width, so the comments would still stagger. This
 * measures the whole line, which is what a formatter aligns on.
 */
interface SchemaLine {
  field: ArgFieldRow;
  kind: FieldKind;
  supplied: string;
  /** Spaces to insert before the comment so every comment starts in one column. */
  pad: string;
}

function layoutLines(row: ToolArgUsageRow): SchemaLine[] {
  const rendered = row.fields.map((field, i) => {
    const supplied = formatPct(field.supplyRate);
    const comma = i < row.fields.length - 1 ? "," : "";
    const text = `    "${field.field}": { "supplied": "${supplied}", "calls": ${field.callsWithField} }${comma}`;
    return { field, supplied, len: text.length };
  });
  const widest = rendered.reduce((w, r) => Math.max(w, r.len), 0);
  return rendered.map((r) => ({
    field: r.field,
    kind: kindOf(r.field, row.schemaCovered),
    supplied: r.supplied,
    pad: " ".repeat(widest - r.len + 2),
  }));
}

export function ToolSchemaView({ row }: { row: ToolArgUsageRow }): ReactElement {
  const lines = layoutLines(row);

  return (
    <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-sunken/50">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-xyne-border-subtle px-3 py-2">
        <span className="font-mono text-[12px] font-medium text-xyne-fg-primary">{row.tool}</span>
        <span className="text-[11px] text-xyne-fg-muted">
          {formatCount(row.calls)} calls ·{" "}
          {row.schemaCovered ? (
            `${row.fields.length} declared field${row.fields.length === 1 ? "" : "s"}`
          ) : (
            <span title="Only custom tools expose a schema that joins by name. For the rest these are the fields observed at runtime, and dead fields are unknown rather than absent.">
              observed fields only — no declared schema to join
            </span>
          )}
        </span>
      </div>

      <div className="overflow-x-auto px-3 py-2.5">
        <pre className="font-mono text-[12px] leading-[1.7] text-xyne-fg-secondary">
          <Punct>{"{"}</Punct>
          {"\n  "}
          <Key>&quot;tool&quot;</Key>
          <Punct>: </Punct>
          <Str>&quot;{row.tool}&quot;</Str>
          <Punct>,</Punct>
          {"\n  "}
          <Key>&quot;calls&quot;</Key>
          <Punct>: </Punct>
          <Num>{row.calls}</Num>
          <Punct>,</Punct>
          {"\n  "}
          <Key>{row.schemaCovered ? '"inputSchema"' : '"observedArgs"'}</Key>
          <Punct>: {"{"}</Punct>
          {row.fields.length === 0 && <Punct>{"  "}</Punct>}
          {lines.map(({ field, kind, supplied, pad }, i) => {
            const color = KIND_COLOR[kind];
            return (
              <span key={field.field}>
                {"\n    "}
                <Key>&quot;{field.field}&quot;</Key>
                <Punct>: </Punct>
                <Punct>{"{ "}</Punct>
                <Key>&quot;supplied&quot;</Key>
                <Punct>: </Punct>
                <Str style={color ? { color } : undefined}>&quot;{supplied}&quot;</Str>
                <Punct>, </Punct>
                <Key>&quot;calls&quot;</Key>
                <Punct>: </Punct>
                <Num>{field.callsWithField}</Num>
                <Punct>{" }"}</Punct>
                {i < lines.length - 1 && <Punct>,</Punct>}
                {/* The annotation sits outside the JSON as a comment would, so
                    the structure above stays valid-looking JSON. */}
                <span style={{ color: color ?? "var(--metrics-muted-mark)" }}>
                  {pad}
                  {`// ${KIND_NOTE[kind]}`}
                </span>
              </span>
            );
          })}
          {"\n  "}
          <Punct>{"}"}</Punct>
          {"\n"}
          <Punct>{"}"}</Punct>
        </pre>
      </div>

      {(row.deadFields.length > 0 || row.undeclaredFields.length > 0) && (
        <div className="flex flex-col gap-1 border-t border-xyne-border-subtle px-3 py-2 text-[11px]">
          {row.schemaCovered && row.deadFields.length > 0 && (
            <p className="text-xyne-fg-muted">
              <span style={{ color: STATUS.warning }}>Never supplied:</span>{" "}
              <span className="font-mono">{row.deadFields.join(", ")}</span> — schema the model
              does not use.
            </p>
          )}
          {row.undeclaredFields.length > 0 && (
            <p className="text-xyne-fg-muted">
              <span style={{ color: STATUS.serious }}>Undeclared:</span>{" "}
              <span className="font-mono">{row.undeclaredFields.join(", ")}</span> — supplied by
              the model but absent from the schema.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── JSON tokens ──────────────────────────────────────────────────────────
   Text tokens, not a syntax theme: keys carry the emphasis, punctuation
   recedes, and hue is reserved for the two findings that need it. */

const Punct = ({ children }: { children: ReactNode }): ReactElement => (
  <span className="text-xyne-fg-muted/70">{children}</span>
);

const Key = ({ children }: { children: ReactNode }): ReactElement => (
  <span className="text-xyne-fg-primary">{children}</span>
);

const Str = ({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties | undefined;
}): ReactElement => (
  <span className="text-xyne-fg-secondary" style={style}>
    {children}
  </span>
);

const Num = ({ children }: { children: ReactNode }): ReactElement => (
  <span className="text-xyne-fg-secondary tabular-nums">{children}</span>
);
