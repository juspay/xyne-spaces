import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import { Badge } from "./Badge";
import { Menu, MenuItem } from "./Menu";
import { cn } from "../../../lib/utils";

interface OverflowBadgeRowProps<T extends string> {
  items: readonly T[];
  selected: T;
  onSelect: (item: T) => void;
  className?: string;
  "data-id"?: string;
}

/**
 * Horizontal row of selectable badges that overflow into a dropdown menu.
 *
 * Layout strategy:
 *   1. Render every item in a hidden measurement layer.
 *   2. ResizeObserver triggers a recalc whenever the container width changes.
 *   3. Sum up item widths until they would exceed the container; the surplus
 *      goes into a "More" menu (always reserves room for the More button if
 *      not all items fit).
 */
export function OverflowBadgeRow<T extends string>({
  items,
  selected,
  onSelect,
  className,
  "data-id": dataId,
}: OverflowBadgeRowProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef   = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);

  /* matches gap-1 (4px) on the row */
  const GAP = 4;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure   = measureRef.current;
    if (!container || !measure) return;

    function recalc() {
      const containerWidth = container!.offsetWidth;
      const moreEl  = measure!.querySelector<HTMLElement>("[data-measure-more]");
      const itemEls = measure!.querySelectorAll<HTMLElement>("[data-measure-item]");
      const moreWidth = moreEl?.offsetWidth ?? 0;

      let used = 0;
      let count = items.length;

      for (let i = 0; i < itemEls.length; i++) {
        const el = itemEls[i];
        if (!el) break;
        const w = el.offsetWidth;
        const reserveMore = i < itemEls.length - 1 ? moreWidth + GAP : 0;
        if (used + w + reserveMore > containerWidth) {
          count = i;
          break;
        }
        used += w + GAP;
      }
      setVisibleCount(count);
    }

    recalc();
    const obs = new ResizeObserver(recalc);
    obs.observe(container);
    return () => obs.disconnect();
  }, [items]);

  useEffect(() => {
    setVisibleCount(items.length);
  }, [items.length]);

  const visible     = items.slice(0, visibleCount);
  const overflow    = items.slice(visibleCount);
  const hasOverflow = overflow.length > 0;

  return (
    <div
      data-id={dataId ?? "overflow-badge-row"}
      className={cn("relative flex min-w-0 flex-1 items-center", className)}
    >
      {/* ── Hidden measurement layer ─────────────────────────────── */}
      <div
        ref={measureRef}
        aria-hidden
        className="invisible pointer-events-none absolute inset-0 flex items-center gap-1"
      >
        {items.map((item) => (
          <span key={`m-${item}`} data-measure-item>
            <Badge label={item} selected={item === selected} />
          </span>
        ))}
        <span data-measure-more>
          <Badge label="More" />
        </span>
      </div>

      {/* ── Visible row ──────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
      >
        {visible.map((item) => (
          <Badge
            key={item}
            label={item}
            selected={item === selected}
            onClick={() => onSelect(item)}
          />
        ))}

        {hasOverflow && (
          <Menu
            trigger={(triggerProps) => (
              <button
                {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                type="button"
                data-id="overflow-more-trigger"
                className={cn(
                  /* mimics Badge: neutral variant, md size, interactive */
                  "inline-flex items-center justify-center whitespace-nowrap select-none",
                  "rounded-full leading-none cursor-pointer",
                  "h-[24px] px-2.5 text-[13px] font-normal gap-1",
                  "bg-transparent text-xyne-fg-muted border border-xyne-border",
                  "hover:border-xyne-border-strong hover:text-xyne-fg-primary",
                  "transition-[background-color,color,border-color] duration-[var(--comp-duration-normal)] ease-in",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-border-focus focus-visible:ring-offset-1",
                )}
              >
                More
                <span className="text-[11px] opacity-70">+{overflow.length}</span>
              </button>
            )}
          >
            {overflow.map((item) => (
              <MenuItem
                key={item}
                onSelect={() => onSelect(item)}
                selected={item === selected}
                trailing={
                  item === selected ? <CheckIcon size={12} weight="bold" /> : undefined
                }
              >
                {item}
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>
    </div>
  );
}
