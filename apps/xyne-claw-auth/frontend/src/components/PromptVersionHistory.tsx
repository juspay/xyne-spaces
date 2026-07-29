import { useCallback, useEffect, useMemo, useState } from "react";
import { diffLines as jsDiffLines, type Change } from "diff";
import { getPromptVersions, activatePromptVersion, type PromptVersion } from "../lib/api";

/**
 * Prompt version history + rollback + diff. Shared by V1 (AgentConfigEditor)
 * and V3 (AgentDetailPageV3). Lists every immutable prompt version
 * newest-first; lets an owner/admin view a version's full text, compare any
 * two versions as a line diff, and roll back to one.
 *
 * `onActivated` is called after a successful rollback with the restored prompt
 * text, so the parent can both update its editor field and re-pull the agent.
 */

type DiffRow = { type: "eq" | "add" | "del"; text: string };

/**
 * Line-level diff using jsdiff (the `diff` package) — the same Myers algorithm
 * git uses. We flatten jsdiff's per-chunk Change[] (each chunk's `value` may
 * span multiple lines) into one DiffRow per line for rendering.
 */
function computeDiff(aText: string, bText: string): DiffRow[] {
  const changes: Change[] = jsDiffLines(aText, bText);
  const rows: DiffRow[] = [];
  for (const c of changes) {
    const type: DiffRow["type"] = c.added ? "add" : c.removed ? "del" : "eq";
    const lines = c.value.split("\n");
    // jsdiff keeps the trailing newline, producing a dangling "" — drop it.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (const text of lines) rows.push({ type, text });
  }
  return rows;
}

export function PromptVersionHistory({
  agentSlug,
  activeVersion,
  onActivated,
  readOnly = false,
}: {
  agentSlug: string;
  /** Active version number from the agent; used to highlight + bump the refresh. */
  activeVersion?: number | null;
  onActivated?: (restoredSystemPrompt: string) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [active, setActive] = useState<number | null>(activeVersion ?? null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activating, setActivating] = useState<number | null>(null);

  // Compare mode.
  const [compare, setCompare] = useState(false);
  const [baseV, setBaseV] = useState<number | null>(null);
  const [targetV, setTargetV] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getPromptVersions(agentSlug);
      setVersions(res.versions);
      setActive(res.activeVersion);
      // Default the diff to (second-newest → newest) once we have versions.
      if (res.versions.length >= 2) {
        setBaseV((prev) => prev ?? res.versions[1]!.version);
        setTargetV((prev) => prev ?? res.versions[0]!.version);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load versions");
    } finally {
      setLoading(false);
    }
  }, [agentSlug]);

  useEffect(() => {
    if (open) void load();
  }, [open, load, activeVersion]);

  const handleActivate = async (version: number) => {
    if (readOnly) return;
    setActivating(version);
    setError(null);
    try {
      const updated = await activatePromptVersion(agentSlug, version);
      await load();
      onActivated?.(updated.systemPrompt ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate");
    } finally {
      setActivating(null);
    }
  };

  const byVersion = useMemo(() => {
    const map = new Map<number, PromptVersion>();
    for (const v of versions) map.set(v.version, v);
    return map;
  }, [versions]);

  const diff = useMemo(() => {
    if (!compare || baseV == null || targetV == null) return null;
    const a = byVersion.get(baseV);
    const b = byVersion.get(targetV);
    if (!a || !b) return null;
    return computeDiff(a.systemPrompt, b.systemPrompt);
  }, [compare, baseV, targetV, byVersion]);

  const diffStats = useMemo(() => {
    if (!diff) return null;
    let add = 0;
    let del = 0;
    for (const r of diff) {
      if (r.type === "add") add++;
      else if (r.type === "del") del++;
    }
    return { add, del };
  }, [diff]);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200"
        >
          <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          Version history
          {active != null && (
            <span className="rounded bg-zinc-700/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
              v{active} active
            </span>
          )}
        </button>
        {open && versions.length >= 2 && (
          <button
            type="button"
            onClick={() => setCompare((c) => !c)}
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${compare ? "bg-cyan-950/40 text-cyan-300" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            {compare ? "✕ Close compare" : "⇄ Compare"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
          {loading && <p className="px-2 py-3 text-center text-xs text-zinc-500">Loading…</p>}
          {error && <p className="px-2 py-2 text-xs text-red-400">{error}</p>}
          {!loading && versions.length === 0 && !error && (
            <p className="px-2 py-3 text-center text-xs text-zinc-500">No versions yet.</p>
          )}

          {/* Compare panel */}
          {compare && versions.length >= 2 && (
            <div className="mb-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span>Base</span>
                <select
                  value={baseV ?? ""}
                  onChange={(e) => setBaseV(Number(e.target.value))}
                  className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.version}>v{v.version}{v.version === active ? " (active)" : ""}</option>
                  ))}
                </select>
                <span>→</span>
                <select
                  value={targetV ?? ""}
                  onChange={(e) => setTargetV(Number(e.target.value))}
                  className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.version}>v{v.version}{v.version === active ? " (active)" : ""}</option>
                  ))}
                </select>
                {diffStats && (
                  <span className="ml-auto font-mono">
                    <span className="text-green-400">+{diffStats.add}</span>{" "}
                    <span className="text-red-400">−{diffStats.del}</span>
                  </span>
                )}
              </div>
              {diff && (
                diff.every((r) => r.type === "eq") ? (
                  <p className="px-1 py-2 text-center text-[11px] text-zinc-500">Identical — no differences.</p>
                ) : (
                  <pre className="max-h-80 overflow-auto rounded bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
                    {diff.map((r, idx) => (
                      <div
                        key={idx}
                        className={
                          r.type === "add"
                            ? "bg-green-950/40 text-green-300"
                            : r.type === "del"
                              ? "bg-red-950/40 text-red-300"
                              : "text-zinc-400"
                        }
                      >
                        <span className="select-none opacity-60">{r.type === "add" ? "+ " : r.type === "del" ? "− " : "  "}</span>
                        {r.text || " "}
                      </div>
                    ))}
                  </pre>
                )
              )}
            </div>
          )}

          {/* Version list */}
          <ul className="flex flex-col gap-1">
            {versions.map((v) => {
              const isActive = v.version === active;
              const isExpanded = expandedId === v.id;
              return (
                <li key={v.id} className="rounded-md border border-zinc-800 bg-zinc-950/40">
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${isActive ? "bg-green-900/50 text-green-300" : "bg-zinc-800 text-zinc-400"}`}>
                      v{v.version}
                    </span>
                    {isActive && <span className="text-[10px] font-medium text-green-400">active</span>}
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
                      {v.note || <span className="text-zinc-600">no note</span>}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-600">
                      {new Date(v.createdAt).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : v.id)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      {isExpanded ? "Hide" : "View"}
                    </button>
                    {!isActive && !readOnly && (
                      <button
                        type="button"
                        disabled={activating !== null}
                        onClick={() => void handleActivate(v.version)}
                        className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-cyan-300 hover:border-cyan-600 hover:bg-cyan-950/30 disabled:opacity-50"
                      >
                        {activating === v.version ? "Activating…" : "Restore"}
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-zinc-800 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-300">
                      {v.systemPrompt}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
