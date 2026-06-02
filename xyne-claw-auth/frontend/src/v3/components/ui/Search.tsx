import { useRef } from "react";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "../../../lib/utils";

interface SearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "data-id"?: string;
}

/**
 * Search input with default and active (focused) states.
 *
 * Default  — gray border, muted icon
 * Active   — brand border + focus ring, dark icon
 * Has text — clear (×) button appears on the right
 *
 * All colours and sizing come from design tokens.
 */
export function Search({
  value,
  onChange,
  placeholder = "Search…",
  className,
  "data-id": dataId,
}: SearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClear() {
    onChange("");
    inputRef.current?.focus();
  }

  return (
    <div
      data-id={dataId ?? "search"}
      className={cn(
        /* layout */
        "group relative flex h-8 shrink-0 items-center outline-none",
        /* shape */
        "rounded-full border bg-xyne-surface",
        /* default state */
        "border-xyne-border",
        "transition-[border-color,box-shadow]",
        "duration-[var(--comp-duration-normal)] ease-in",
        "focus-within:border-xyne-border-strong",
        className
      )}
    >
      {/* ── Search icon ──────────────────────────────────── */}
      <MagnifyingGlassIcon
        size={14}
        weight="regular"
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-3 shrink-0",
          /* default: muted; active: primary */
          "text-xyne-fg-muted",
          "transition-colors duration-[var(--comp-duration-normal)] ease-in",
          "group-focus-within:text-xyne-fg-primary",
        )}
      />

      {/* ── Text input ───────────────────────────────────── */}
      <input
        ref={inputRef}
        data-id={dataId ? `${dataId}-input` : "search-input"}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-full w-full bg-transparent outline-none focus:outline-none focus-visible:outline-none",
          "pl-8 text-[13px] font-normal",
          "text-xyne-fg-primary placeholder:text-xyne-fg-placeholder",
          /* right padding: make room for clear button when there's a value */
          value ? "pr-7" : "pr-3",
        )}
      />

      {/* ── Clear button (visible only when there's a value) ── */}
      {value && (
        <button
          type="button"
          data-id={dataId ? `${dataId}-clear` : "search-clear"}
          onClick={handleClear}
          aria-label="Clear search"
      className={cn(
            "absolute right-2.5",
            "flex h-[18px] w-[18px] items-center justify-center rounded-full",
            "bg-xyne-neutral-bg text-xyne-fg-muted",
            "transition-[background-color,color] duration-[var(--comp-duration-fast)] ease-in",
            "hover:bg-xyne-border-strong hover:text-xyne-fg-primary",
          )}
        >
          <XIcon size={9} weight="bold" />
        </button>
      )}
    </div>
  );
}
