import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Collapsible section with a header row (title + optional right-side badge)
 * and a body that toggles open on click. Used in the agent configure page
 * for the Tools accordion (Subagents / Write / MCP / System) and reused in
 * the Subagents tab so the picker UX is identical across both screens.
 *
 * Two visual modes:
 *   `bordered={true}`  — outlined card, used as the top-level "Tools" card
 *   `bordered={false}` — minimal row, used as inner accordion entries
 */
export function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  bordered = true,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const outerCls = bordered
    ? "rounded-lg border border-zinc-800 bg-zinc-900"
    : "rounded-md";
  return (
    <div className={outerCls}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-3 ${bordered ? "px-5 py-3" : "px-3 py-2"} text-left transition hover:bg-zinc-800/40`}
        aria-expanded={open}
      >
        <span className={`flex items-center gap-2 ${bordered ? "text-sm font-semibold text-zinc-200" : "text-xs font-medium text-zinc-400"}`}>
          {open ? <ChevronDown size={bordered ? 14 : 12} /> : <ChevronRight size={bordered ? 14 : 12} />}
          {title}
        </span>
        {badge != null && badge !== "" && (
          <span className={`text-xs ${bordered ? "text-zinc-500" : "text-zinc-600"}`}>{badge}</span>
        )}
      </button>
      {open && (
        <div className={bordered ? "border-t border-zinc-800 p-5" : "px-3 pb-2"}>
          {children}
        </div>
      )}
    </div>
  );
}
