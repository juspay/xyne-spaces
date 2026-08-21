/**
 * Right-side overlay for a drill-down.
 *
 * The failure list used to render as a card inline above the tools table. The
 * trigger is a row in that table, so opening it inserted content off-screen
 * above the reader's scroll position and looked like nothing had happened.
 *
 * An overlay is the fix rather than a scroll-into-view: the detail belongs to a
 * row, not to the page flow, and the reader's place in a long table survives
 * opening and closing it.
 *
 * Not built on v3's `SidePanel`, which is a flex sibling sized to a row layout;
 * this page is a centered scrolling column, so the panel has to be fixed.
 */

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { X } from "lucide-react";

export function MetricsDrawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Move focus in so Escape and tabbing land here rather than the page behind.
    panelRef.current?.focus();
    // The page behind must not scroll under the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex h-full w-[min(620px,100vw)] flex-col bg-xyne-surface shadow-2xl outline-none"
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-xyne-border-subtle px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-mono text-[15px] font-semibold text-xyne-fg-primary">
              {title}
            </h2>
            {subtitle && <div className="mt-1 text-[12px] text-xyne-fg-muted">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-xyne-fg-muted hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
