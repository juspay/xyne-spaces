import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Hash, Ticket, FileText, Phone, Search, Loader2, GitBranch } from "lucide-react";
import { searchContext, type ContextItem, type ContextSearchType, type ContextType } from "../lib/api";

interface Props {
  slug: string;
  userId: string;
  open: boolean;
  tab: ContextSearchType;
  query: string;
  selectedKeys: Set<string>;
  onTabChange: (tab: ContextSearchType) => void;
  onQueryChange: (query: string) => void;
  onSelect: (item: ContextItem) => void;
  onClose: () => void;
}

const TABS: Array<{ id: ContextSearchType; label: string }> = [
  { id: "all", label: "All" },
  { id: "channel", label: "Channels" },
  { id: "ticket", label: "Tickets" },
  { id: "canvas", label: "Canvases" },
  { id: "call", label: "Calls" },
];

export function ContextPicker({
  slug,
  userId,
  open,
  tab,
  query,
  selectedKeys,
  onTabChange,
  onQueryChange,
  onSelect,
  onClose,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ContextItem[]>([]);
  const tabs = useMemo(
    () => slug === "sdlc-agent" ? [...TABS, { id: "repository" as const, label: "Repositories" }] : TABS,
    [slug],
  );

  useEffect(() => {
    if (slug !== "sdlc-agent" && tab === "repository") onTabChange("all");
  }, [slug, tab, onTabChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent): void {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      onClose();
    }
    function onEsc(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    searchContext(slug, userId, { type: tab, q: debouncedQuery, limit: 20 })
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setItems([]);
        setError(err instanceof Error ? err.message : "Failed to search context");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, slug, userId, tab, debouncedQuery]);

  const title = useMemo(() => {
    if (tab === "all") return "Attach context";
    if (tab === "channel") return "Attach channels";
    if (tab === "ticket") return "Attach tickets";
    if (tab === "canvas") return "Attach canvases";
    if (tab === "repository") return "Select SDLC repository";
    return "Attach calls";
  }, [tab]);

  return (
    <div ref={rootRef} className="w-[40rem] max-w-[calc(100vw-4rem)] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="border-b border-zinc-800 px-4 py-3">
        <p className="text-sm font-medium text-zinc-100">{title}</p>
      </div>

      <div className="border-b border-zinc-800 px-4 pt-3">
        <div className="mb-3 flex flex-wrap gap-1">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onTabChange(entry.id)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                tab === entry.id
                  ? "bg-cyan-500/20 text-cyan-300"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="mb-3 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
          <Search size={14} className="text-zinc-500" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={slug === "sdlc-agent"
              ? "Search channels, tickets, canvases, calls, repositories..."
              : "Search channels, tickets, canvases, calls..."}
            className="w-full bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
            autoFocus
          />
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto px-2 py-2">
        {loading && (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-zinc-500">
            <Loader2 size={14} className="animate-spin" />
            Searching…
          </div>
        )}

        {!loading && error && (
          <div className="px-2 py-3 text-sm text-red-400">{error}</div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="px-2 py-3 text-sm text-zinc-500">No results.</div>
        )}

        {!loading && !error && items.map((item) => {
          const key = makeKey(item);
          const selected = selectedKeys.has(key);
          return (
            <button
              key={key}
              disabled={selected}
              onClick={() => onSelect(item)}
              className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition ${
                selected
                  ? "cursor-not-allowed bg-zinc-800/60 text-zinc-500"
                  : "bg-zinc-800/30 text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {typeIcon(item.type)}
                  <p className="truncate text-sm">{item.title}</p>
                </div>
                {item.subtitle && (
                  <p className="truncate pl-6 text-xs text-zinc-500">{item.subtitle}</p>
                )}
              </div>
              <span className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase ${typeBadgeClass(item.type)}`}>
                {item.type}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function makeKey(item: Pick<ContextItem, "type" | "id">): string {
  return `${item.type}:${item.id}`;
}

function typeIcon(type: ContextType): ReactElement {
  if (type === "channel") return <Hash size={14} className="text-cyan-400" />;
  if (type === "ticket") return <Ticket size={14} className="text-amber-400" />;
  if (type === "canvas") return <FileText size={14} className="text-emerald-400" />;
  if (type === "repository") return <GitBranch size={14} className="text-blue-400" />;
  return <Phone size={14} className="text-fuchsia-400" />;
}

function typeBadgeClass(type: ContextType): string {
  if (type === "channel") return "bg-cyan-500/20 text-cyan-300";
  if (type === "ticket") return "bg-amber-500/20 text-amber-300";
  if (type === "canvas") return "bg-emerald-500/20 text-emerald-300";
  if (type === "repository") return "bg-blue-500/20 text-blue-300";
  return "bg-fuchsia-500/20 text-fuchsia-300";
}
