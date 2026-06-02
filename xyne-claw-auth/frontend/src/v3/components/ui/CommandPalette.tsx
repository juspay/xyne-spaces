import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

export interface CommandItem {
  id: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  navigateTo?: string;
  action?: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  /* Reset selection when results change */
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, query]);

  /* Keep selected item in view */
  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-cmd-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  /* Focus input on open */
  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  /* Global keyboard handler */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) {
          if (item.navigateTo) navigate(item.navigateTo);
          item.action?.();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, selectedIndex, onClose, navigate]);

  if (!open) return null;

  return (
    <div
      data-id="command-palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
    >
      {/* Backdrop */}
      <div
        data-id="command-palette-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Card */}
      <div
        data-id="command-palette-card"
        className="relative flex w-[560px] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-xyne-border-subtle bg-xyne-surface shadow-2xl"
      >
        {/* Search */}
        <div className="flex items-center gap-2 border-b border-xyne-border-subtle px-4 py-3">
          <MagnifyingGlassIcon
            size={18}
            className="shrink-0 text-xyne-fg-tertiary"
          />
          <input
            ref={inputRef}
            data-id="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-[14px] text-xyne-fg-primary outline-none placeholder:text-xyne-fg-tertiary"
          />
          <kbd className="rounded-md border border-xyne-border bg-xyne-surface-subtle px-1.5 py-0.5 text-[11px] text-xyne-fg-tertiary">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          data-id="command-palette-results"
          className="max-h-[50vh] overflow-y-auto py-2"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-xyne-fg-tertiary">
              No results found
            </div>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={item.id}
                  data-id={`command-palette-item-${item.id}`}
                  data-cmd-index={index}
                  onClick={() => {
                    if (item.navigateTo) navigate(item.navigateTo);
                    item.action?.();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    isSelected
                      ? "bg-xyne-surface-subtle"
                      : "hover:bg-xyne-surface-subtle/50"
                  }`}
                >
                  <Icon
                    size={16}
                    className="shrink-0 text-xyne-fg-tertiary"
                  />
                  <span className="flex-1 text-[13px] text-xyne-fg-primary">
                    {item.label}
                  </span>
                  {item.shortcut && (
                    <kbd className="rounded-md border border-xyne-border bg-xyne-surface-subtle px-1.5 py-0.5 text-[11px] text-xyne-fg-tertiary">
                      {item.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
