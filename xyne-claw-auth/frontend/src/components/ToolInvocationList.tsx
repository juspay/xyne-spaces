import { useMemo, useState } from "react";
import type { ToolInvocation } from "../lib/api";

/**
 * Renders a flat list of tool invocations with nested subagent children folded
 * under their parent. The parent is identified by matching
 * `child.parentToolCallId === parent.toolCallId`.
 */
export function ToolInvocationList({ invocations }: { invocations: ToolInvocation[] }) {
  // Group invocations: top-level (no parentToolCallId) stay at root; others
  // are mapped under the parent toolCallId they belong to.
  const { roots, childrenByParent } = useMemo(() => {
    const rootsArr: ToolInvocation[] = [];
    const map = new Map<string, ToolInvocation[]>();
    for (const inv of invocations) {
      if (inv.parentToolCallId) {
        const list = map.get(inv.parentToolCallId) ?? [];
        list.push(inv);
        map.set(inv.parentToolCallId, list);
      } else {
        rootsArr.push(inv);
      }
    }
    return { roots: rootsArr, childrenByParent: map };
  }, [invocations]);

  if (roots.length === 0 && childrenByParent.size === 0) return null;

  // If we only have orphan children (parent not yet seen), still render them
  // at root level so nothing is hidden during streaming.
  const orphans: ToolInvocation[] = [];
  if (roots.length === 0 && childrenByParent.size > 0) {
    for (const arr of childrenByParent.values()) orphans.push(...arr);
  }

  const toRender = roots.length > 0 ? roots : orphans;

  return (
    <div className="mt-2 space-y-1.5">
      {toRender.map((inv, i) => (
        <ToolInvocationItem
          key={inv.toolCallId ?? `${inv.toolName}-${i}`}
          invocation={inv}
          children={inv.toolCallId ? childrenByParent.get(inv.toolCallId) : undefined}
        />
      ))}
    </div>
  );
}

function ToolInvocationItem({
  invocation,
  children,
}: {
  invocation: ToolInvocation;
  children?: ToolInvocation[];
}) {
  const [expanded, setExpanded] = useState(false);

  const argsPreview = useMemo(() => {
    try {
      const s = JSON.stringify(invocation.args ?? {});
      return s.length > 80 ? s.slice(0, 80) + "…" : s;
    } catch { return String(invocation.args); }
  }, [invocation.args]);

  const argsFull = useMemo(() => {
    try { return JSON.stringify(invocation.args ?? {}, null, 2); }
    catch { return String(invocation.args); }
  }, [invocation.args]);

  // Subagent rows get a distinct border + icon so nested structure reads.
  const isSubagent = children && children.length > 0;

  return (
    <div className={`rounded-md border ${invocation.isError ? "border-red-900/50 bg-red-950/20" : isSubagent ? "border-purple-900/50 bg-purple-950/10" : "border-zinc-800 bg-zinc-900/60"} p-2`}>
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-start gap-2 text-left">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`mt-1 shrink-0 text-zinc-500 transition ${expanded ? "rotate-90" : ""}`}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            {invocation.subagentName && (
              <span className="rounded bg-purple-950 px-1.5 py-0.5 text-[10px] text-purple-300">{invocation.subagentName}</span>
            )}
            {isSubagent && <span className="text-xs text-purple-400">🤖</span>}
            <code className="font-mono text-zinc-200">{invocation.toolName}</code>
            {invocation.isError && <span className="rounded bg-red-950 px-1.5 py-0.5 text-[10px] text-red-400">error</span>}
            <span className="ml-auto font-mono text-zinc-600">{invocation.durationMs}ms</span>
          </div>
          {!expanded && <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{argsPreview}</p>}
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 text-[11px]">
          <div>
            <div className="mb-0.5 text-zinc-500">Args</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-zinc-300">{argsFull}</pre>
          </div>
          <div>
            <div className="mb-0.5 text-zinc-500">Result</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-zinc-300">{invocation.result || "(empty)"}</pre>
          </div>
        </div>
      )}
      {/* Nested child invocations — the subagent's own tool calls */}
      {children && children.length > 0 && (
        <div className="mt-2 ml-4 border-l border-purple-900/40 pl-3 space-y-1.5">
          {children.map((child, i) => (
            <ToolInvocationItem
              key={child.toolCallId ?? `${child.toolName}-${i}`}
              invocation={child}
            />
          ))}
        </div>
      )}
    </div>
  );
}
