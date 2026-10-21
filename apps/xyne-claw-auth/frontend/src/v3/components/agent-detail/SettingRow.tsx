/**
 * SettingGroup / SettingRow — the shared shape for agent behaviour settings.
 *
 * Replaces the previous pattern of one `rounded-xl border p-4` card per
 * setting, each with a tiny uppercase caption and two to four sentences of
 * always-visible rationale. Fifteen of those stacked into a ~6,800px wall in
 * which nothing was findable and everything had equal weight.
 *
 * The shape here is the one the Spaces dashboard uses for the same job:
 *  - related settings share one bordered card under a heading,
 *  - each row is a sentence-case title + a single line of what it does,
 *  - the "why / when to use it" copy is kept verbatim but moves behind a
 *    per-row disclosure, so it is one click away instead of always on screen,
 *  - the control sits right-aligned, and enabled rows are tinted so the
 *    configured state reads at a glance.
 */
import { useState, type ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";

export function SettingGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5 px-0.5">
        <h3 className="text-[13px] font-semibold text-xyne-fg-primary">{title}</h3>
        {description && (
          <p className="text-[12px] leading-relaxed text-xyne-fg-tertiary">{description}</p>
        )}
      </div>
      <div className="divide-y divide-xyne-border-subtle overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  title,
  summary,
  detail,
  control,
  enabled = false,
  children,
}: {
  title: string;
  /** One line: what this does. Always visible. */
  summary: ReactNode;
  /** Why / when to use it. Hidden behind the row's "Details" disclosure. */
  detail?: ReactNode;
  /** Right-aligned control — a Switch, select, or anything else. */
  control: ReactNode;
  /** Tints the row so a configured agent is scannable. */
  enabled?: boolean;
  /** Sub-configuration revealed under the row (usually when `enabled`). */
  children?: ReactNode;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  return (
    <div className={enabled ? "bg-xyne-surface-subtle/60" : undefined}>
      <div className="flex items-start justify-between gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-xyne-fg-primary">{title}</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-xyne-fg-secondary">{summary}</p>
          {detail && (
            <>
              <button
                type="button"
                onClick={() => setDetailOpen((o) => !o)}
                aria-expanded={detailOpen}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-xyne-fg-tertiary transition-colors hover:text-xyne-fg-primary"
              >
                <CaretDownIcon
                  size={10}
                  weight="bold"
                  className={`transition-transform ${detailOpen ? "rotate-180" : ""}`}
                />
                {detailOpen ? "Hide details" : "Details"}
              </button>
              {detailOpen && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-xyne-fg-tertiary">{detail}</p>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center pt-0.5">{control}</div>
      </div>
      {children && <div className="border-t border-xyne-border-subtle px-4 py-3">{children}</div>}
    </div>
  );
}
