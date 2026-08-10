import { useCallback, useEffect, useMemo, useState } from "react";
import { diffLines as jsDiffLines, type Change } from "diff";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import {
  getSkillVersions,
  getSkillVersion,
  restoreSkillVersion,
  type SkillVersion,
} from "../../../lib/api";
import { useSnackbar } from "../ui/Snackbar";

/* ── Diff helpers ────────────────────────────────────────────────────── */

type DiffRow = { type: "eq" | "add" | "del"; text: string };

function computeDiff(aText: string, bText: string): DiffRow[] {
  const changes: Change[] = jsDiffLines(aText, bText);
  const rows: DiffRow[] = [];
  for (const c of changes) {
    const type: DiffRow["type"] = c.added ? "add" : c.removed ? "del" : "eq";
    const lines = c.value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (const text of lines) rows.push({ type, text });
  }
  return rows;
}

/* ── Component ───────────────────────────────────────────────────────── */

/**
 * Skill version history + rollback — the skills analogue of
 * PromptVersionHistory. Lists a skill's immutable versions newest-first, lets
 * the owner/admin view any version's content, compare two versions, and
 * "Restore" the live skill to an older version. The version list is light
 * (no content); full content is lazy-loaded per version and cached.
 */
export function SkillVersionHistory({
  slug,
  readOnly = false,
  onRestored,
}: {
  slug: string;
  readOnly?: boolean;
  onRestored?: (restoredContent: string) => void;
}) {
  const { show: showSnackbar } = useSnackbar();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [contentByVersion, setContentByVersion] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const [compare, setCompare] = useState(false);
  const [baseV, setBaseV] = useState<number | null>(null);
  const [targetV, setTargetV] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSkillVersions(slug);
      setVersions(res);
      if (res.length >= 2) {
        setBaseV((p) => p ?? res[1]!.version);
        setTargetV((p) => p ?? res[0]!.version);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load versions");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Lazy-load a version's full content (the list omits it to stay light).
  const ensureContent = useCallback(
    async (version: number): Promise<string> => {
      const cached = contentByVersion[version];
      if (cached !== undefined) return cached;
      const full = await getSkillVersion(slug, version);
      setContentByVersion((m) => ({ ...m, [version]: full.content }));
      return full.content;
    },
    [slug, contentByVersion],
  );

  const handleToggleView = useCallback(
    async (version: number) => {
      if (expanded === version) {
        setExpanded(null);
        return;
      }
      try {
        await ensureContent(version);
        setExpanded(version);
      } catch {
        setError("Failed to load version content");
      }
    },
    [expanded, ensureContent],
  );

  const handleRestore = useCallback(
    async (version: number) => {
      if (readOnly || restoring !== null) return;
      setRestoring(version);
      setError(null);
      try {
        const updated = await restoreSkillVersion(slug, version);
        showSnackbar({ variant: "success", title: `Restored to v${version}` });
        onRestored?.(updated.content ?? "");
        setContentByVersion({});
        setExpanded(null);
        await load();
      } catch (err) {
        const status = (err as { status?: number })?.status;
        showSnackbar({
          variant: "error",
          title: status === 403 ? "Only the owner or an admin can restore" : "Failed to restore",
        });
      } finally {
        setRestoring(null);
      }
    },
    [readOnly, restoring, slug, onRestored, load, showSnackbar],
  );

  // Preload both sides when comparing.
  useEffect(() => {
    if (!compare || baseV == null || targetV == null) return;
    void ensureContent(baseV);
    void ensureContent(targetV);
  }, [compare, baseV, targetV, ensureContent]);

  const currentVersion = useMemo(
    () => versions.find((v) => v.isCurrent)?.version ?? null,
    [versions],
  );

  const diff = useMemo(() => {
    if (!compare || baseV == null || targetV == null) return null;
    const a = contentByVersion[baseV];
    const b = contentByVersion[targetV];
    if (a === undefined || b === undefined) return null;
    return computeDiff(a, b);
  }, [compare, baseV, targetV, contentByVersion]);

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
    <div className="rounded-[12px] border border-xyne-border-subtle bg-xyne-surface-subtle p-[14px]">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary hover:text-xyne-fg-secondary"
        >
          <ClockCounterClockwiseIcon size={13} />
          Version history
          {currentVersion != null && (
            <span className="rounded bg-xyne-surface-sunken px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-xyne-fg-secondary">
              v{currentVersion} current
            </span>
          )}
        </button>
        {open && versions.length >= 2 && (
          <button
            type="button"
            onClick={() => setCompare((c) => !c)}
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
              compare
                ? "bg-xyne-brand/10 text-xyne-brand"
                : "text-xyne-fg-tertiary hover:text-xyne-fg-secondary"
            }`}
          >
            {compare ? "Close compare" : "Compare"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-[10px]">
          {loading && (
            <p className="py-3 text-center text-[12px] text-xyne-fg-muted">Loading…</p>
          )}
          {error && <p className="py-2 text-[12px] text-xyne-error-fg">{error}</p>}
          {!loading && versions.length === 0 && !error && (
            <p className="py-3 text-center text-[12px] text-xyne-fg-muted">No versions yet.</p>
          )}

          {/* Compare panel */}
          {compare && versions.length >= 2 && (
            <div className="mb-2 rounded-md border border-xyne-border-subtle bg-xyne-surface p-2">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-xyne-fg-tertiary">
                <span>Base</span>
                <select
                  value={baseV ?? ""}
                  onChange={(e) => setBaseV(Number(e.target.value))}
                  className="rounded border border-xyne-border bg-xyne-surface-subtle px-1.5 py-0.5 font-mono text-[11px] text-xyne-fg-primary"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.version}>
                      v{v.version}
                      {v.isCurrent ? " (current)" : ""}
                    </option>
                  ))}
                </select>
                <span>→</span>
                <select
                  value={targetV ?? ""}
                  onChange={(e) => setTargetV(Number(e.target.value))}
                  className="rounded border border-xyne-border bg-xyne-surface-subtle px-1.5 py-0.5 font-mono text-[11px] text-xyne-fg-primary"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.version}>
                      v{v.version}
                      {v.isCurrent ? " (current)" : ""}
                    </option>
                  ))}
                </select>
                {diffStats && (
                  <span className="ml-auto font-mono">
                    <span className="text-xyne-success">+{diffStats.add}</span>{" "}
                    <span className="text-xyne-error-fg">−{diffStats.del}</span>
                  </span>
                )}
              </div>
              {diff ? (
                diff.every((r) => r.type === "eq") ? (
                  <p className="px-1 py-2 text-center text-[11px] text-xyne-fg-muted">
                    Identical — no differences.
                  </p>
                ) : (
                  <pre className="max-h-80 overflow-auto rounded bg-xyne-surface-sunken p-2 font-mono text-[11px] leading-relaxed">
                    {diff.map((r, idx) => (
                      <div
                        key={idx}
                        className={
                          r.type === "add"
                            ? "text-xyne-success"
                            : r.type === "del"
                              ? "text-xyne-error-fg"
                              : "text-xyne-fg-tertiary"
                        }
                      >
                        <span className="select-none opacity-60">
                          {r.type === "add" ? "+ " : r.type === "del" ? "− " : "  "}
                        </span>
                        {r.text || " "}
                      </div>
                    ))}
                  </pre>
                )
              ) : (
                <p className="px-1 py-2 text-center text-[11px] text-xyne-fg-muted">
                  Loading diff…
                </p>
              )}
            </div>
          )}

          {/* Version list */}
          <ul className="flex flex-col gap-1">
            {versions.map((v) => {
              const isExpanded = expanded === v.version;
              return (
                <li
                  key={v.id}
                  className="rounded-md border border-xyne-border-subtle bg-xyne-surface"
                >
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        v.isCurrent
                          ? "bg-xyne-success/15 text-xyne-success"
                          : "bg-xyne-surface-sunken text-xyne-fg-tertiary"
                      }`}
                    >
                      v{v.version}
                    </span>
                    {v.isCurrent && (
                      <span className="shrink-0 text-[10px] font-medium text-xyne-success">
                        current
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12px] text-xyne-fg-secondary">
                      {v.changelog || (
                        <span className="text-xyne-fg-muted">{v.source}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] text-xyne-fg-muted">
                      {new Date(v.createdAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleToggleView(v.version)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-secondary"
                    >
                      {isExpanded ? "Hide" : "View"}
                    </button>
                    {!v.isCurrent && !readOnly && (
                      <button
                        type="button"
                        disabled={restoring !== null}
                        onClick={() => void handleRestore(v.version)}
                        className="shrink-0 rounded border border-xyne-border px-1.5 py-0.5 text-[11px] text-xyne-brand hover:bg-xyne-brand/10 disabled:opacity-50"
                      >
                        {restoring === v.version ? "Restoring…" : "Restore"}
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-xyne-border-subtle px-2.5 py-2 font-mono text-[11px] leading-relaxed text-xyne-fg-secondary">
                      {contentByVersion[v.version] ?? "Loading…"}
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
