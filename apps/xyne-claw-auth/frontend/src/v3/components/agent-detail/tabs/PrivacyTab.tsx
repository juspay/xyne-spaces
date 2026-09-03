import { useState, useEffect, useCallback } from "react";
import { LockIcon, GlobeIcon, XIcon, MagnifyingGlassIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { updateAgent, searchUsers } from "../../../../lib/api";
import type { Agent } from "../../../../lib/types";
import { Avatar } from "../../ui/Avatar";
import { useSnackbar } from "../../ui/Snackbar";

interface Props {
  agent: Agent;
  userId: string;
  canEdit: boolean;
  /** Sync the freshly-saved agent back to the parent so agent.config stays
   *  current — otherwise this panel reverts on remount and the header Save
   *  (which rebuilds config from the parent's agent) would clobber privacy. */
  onAgentUpdated?: (agent: Agent) => void;
}

type Mode = "everyone" | "whitelist";
type DirUser = { id: string; name: string; email: string };

/** Read the privacy block out of an agent's config (mirror of the shared
 *  isAgentInvocableBy contract — inlined to avoid a backend-package import). */
function readPrivacy(config: Record<string, unknown>): { mode: Mode; whitelist: string[] } {
  const raw = config?.["privacy"] as { mode?: unknown; whitelist?: unknown } | undefined;
  if (!raw || typeof raw !== "object" || raw.mode !== "whitelist") return { mode: "everyone", whitelist: [] };
  const whitelist = Array.isArray(raw.whitelist)
    ? raw.whitelist.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
  return { mode: "whitelist", whitelist };
}

/**
 * Privacy panel — controls WHO can invoke this agent (config.privacy),
 * enforced server-side at every dispatch surface (isAgentInvocableBy).
 * "Everyone" (default) = anyone; "Whitelist" = only the listed people, and the
 * list is the exact allowed set (owner/admins are NOT implicitly included).
 * Saves immediately on each change, like the People panel.
 */
export function PrivacyTab({ agent, userId, canEdit, onAgentUpdated }: Props) {
  const { show: showSnackbar } = useSnackbar();
  const initial = readPrivacy(agent.config);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [whitelist, setWhitelist] = useState<string[]>(initial.whitelist);
  const [nameCache, setNameCache] = useState<Record<string, DirUser>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  // Debounced directory search (min 2 chars).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      searchUsers(q, userId)
        .then((users) => {
          if (cancelled) return;
          setResults(users);
          setNameCache((prev) => {
            const next = { ...prev };
            for (const u of users) next[u.id] = u;
            return next;
          });
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, userId]);

  // Persist the given next state as config.privacy. "everyone" clears the key.
  const persist = useCallback(
    async (nextMode: Mode, nextWhitelist: string[]) => {
      setSaving(true);
      const nextConfig: Record<string, unknown> = { ...agent.config };
      if (nextMode === "whitelist") {
        nextConfig["privacy"] = {
          mode: "whitelist",
          whitelist: Array.from(new Set(nextWhitelist)),
        };
      } else {
        delete nextConfig["privacy"];
      }
      try {
        const updated = await updateAgent(agent.slug, { config: nextConfig });
        // Keep the parent's agent (and thus agent.config) in sync so this
        // panel doesn't revert on remount and the header Save preserves privacy.
        onAgentUpdated?.(updated);
        showSnackbar({ variant: "success", title: "Privacy saved" });
      } catch {
        showSnackbar({ variant: "error", title: "Failed to save privacy settings" });
      } finally {
        setSaving(false);
      }
    },
    [agent.config, agent.slug, showSnackbar, onAgentUpdated],
  );

  const changeMode = (next: Mode): void => {
    if (!canEdit || next === mode) return;
    setMode(next);
    void persist(next, whitelist);
  };
  const addUser = (u: DirUser): void => {
    if (whitelist.includes(u.id)) return;
    const next = [...whitelist, u.id];
    setWhitelist(next);
    setQuery("");
    setResults([]);
    void persist("whitelist", next);
  };
  const removeUser = (id: string): void => {
    const next = whitelist.filter((x) => x !== id);
    setWhitelist(next);
    void persist("whitelist", next);
  };

  const visibleResults = results.filter((u) => !whitelist.includes(u.id));

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Mode toggle */}
      <div className="flex gap-2">
        {([
          { value: "everyone", label: "Everyone", desc: "Anyone can call this agent", Icon: GlobeIcon },
          { value: "whitelist", label: "Whitelist", desc: "Only chosen people can call it", Icon: LockIcon },
        ] as const).map((opt) => {
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={!canEdit || saving}
              onClick={() => changeMode(opt.value)}
              className={
                "flex flex-1 flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-colors " +
                (active
                  ? "border-xyne-accent bg-xyne-accent-subtle"
                  : "border-xyne-border hover:bg-xyne-surface-subtle") +
                (!canEdit ? " cursor-default opacity-70" : "")
              }
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-xyne-fg-primary">
                <opt.Icon size={14} weight={active ? "fill" : "regular"} /> {opt.label}
              </span>
              <span className="text-[11px] text-xyne-fg-tertiary">{opt.desc}</span>
            </button>
          );
        })}
      </div>

      {mode === "whitelist" && (
        <div className="flex flex-col gap-3">
          {/* Selected members */}
          {whitelist.length === 0 ? (
            <p className="text-[12px] text-xyne-fg-tertiary">
              No one is allowed yet — an empty whitelist means <span className="font-medium">nobody</span> can call this agent. Add people below.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {whitelist.map((id) => {
                const u = nameCache[id];
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-xyne-border bg-xyne-surface-subtle py-1 pl-1.5 pr-2 text-[12px]"
                    title={u?.email ?? id}
                  >
                    <Avatar name={u?.name ?? id} size={18} shape="circle" />
                    <span className="max-w-[160px] truncate text-xyne-fg-primary">
                      {u?.name ?? `User ${id.slice(0, 8)}…`}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeUser(id)}
                        className="rounded-full p-0.5 text-xyne-fg-muted hover:bg-xyne-error-bg hover:text-xyne-error-fg"
                        aria-label="Remove"
                      >
                        <XIcon size={11} />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}

          {/* Search + add */}
          {canEdit && (
            <div className="relative">
              <div className="flex items-center gap-2 rounded-xl border border-xyne-border px-3 py-2.5">
                <MagnifyingGlassIcon size={15} className="shrink-0 text-xyne-fg-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search people by name or email…"
                  className="w-full bg-transparent text-[13px] text-xyne-fg-primary outline-none placeholder:text-xyne-fg-muted"
                />
                {(searching || saving) && (
                  <CircleNotchIcon size={15} className="shrink-0 animate-spin text-xyne-fg-muted" />
                )}
              </div>
              {visibleResults.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-xyne-border bg-xyne-surface shadow-lg">
                  {visibleResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => addUser(u)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-xyne-surface-subtle"
                    >
                      <Avatar name={u.name} size={24} shape="circle" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-medium text-xyne-fg-primary">{u.name}</span>
                        <span className="truncate text-[11px] text-xyne-fg-tertiary">{u.email}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
