import type { ReactNode, Ref } from "react";
import { X } from "@phosphor-icons/react";

interface SidePanelProps {
  onClose: () => void;
  icon?: ReactNode;
  title: string;
  /** Optional node rendered inline after the title (e.g. a status Badge) */
  badge?: ReactNode;
  subtitle?: string | null;
  footer?: ReactNode;
  /** Action buttons rendered in the header, before the close button */
  actions?: ReactNode;
  width?: number;
  /** Ref to the scrollable body — lets callers track/drive scroll position
   *  (e.g. stick-to-bottom during streaming). */
  bodyRef?: Ref<HTMLDivElement>;
  /**
   * When true, the panel renders as a floating card: pulled in from the edges
   * with rounded corners on all sides and a soft shadow. Default flush-edge
   * behavior is preserved when false (back-compat for existing slide-overs).
   */
  floating?: boolean;
  children: ReactNode;
}

export function SidePanel({ onClose, icon, title, badge, subtitle, footer, actions, width = 560, floating = false, bodyRef, children }: SidePanelProps) {
  return (
    <div
      data-id="side-panel"
      className={
        floating
          ? // Panel stays pure white. The caller wraps this in a tinted
            // "tray" container so the white panel reads as a real floating
            // card lifted above a soft surface. 12px margin on all sides
            // exposes the tray through the gap.
            "flex h-[calc(100%-24px)] m-3 shrink-0 flex-col overflow-hidden bg-xyne-surface rounded-2xl border border-xyne-border-subtle shadow-[0_10px_32px_-12px_rgba(16,24,40,0.10),0_2px_6px_-2px_rgba(16,24,40,0.04)]"
          : "flex h-full shrink-0 flex-col overflow-hidden bg-xyne-surface"
      }
      style={{ width }}
    >
      <div
        data-id="side-panel-header"
        className={`flex shrink-0 items-center gap-3 border-b border-xyne-border-subtle ${
          floating ? "px-6 py-4" : "px-5 py-4"
        }`}
      >
        {icon && (
          <div className="shrink-0 overflow-hidden rounded-lg">{icon}</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 data-id="side-panel-title" className="truncate text-[16px] font-semibold text-xyne-fg-primary">
              {title}
            </h2>
            {badge}
          </div>
          {subtitle && (
            <p data-id="side-panel-subtitle" className="truncate text-[12px] text-xyne-fg-tertiary">
              {subtitle}
            </p>
          )}
        </div>
        {actions}
        <button
          data-id="side-panel-close"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-xyne-surface-subtle text-xyne-fg-secondary transition-colors hover:bg-xyne-border-subtle hover:text-xyne-fg-primary"
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      <div
        ref={bodyRef}
        data-id="side-panel-body"
        className={
          floating
            ? "flex-1 overflow-y-auto px-7 py-6 text-[14px]"
            : "flex-1 overflow-y-auto px-5 py-5 text-[14px]"
        }
      >
        {children}
      </div>

      {footer && (
        <div
          data-id="side-panel-footer"
          // `justify-end` + gap suit button rows; a full-width child (e.g. a
          // chat composer) overrides it with `w-full`, so keep items stretched.
          className={`flex shrink-0 items-center justify-end gap-2 border-t border-xyne-border-subtle ${
            floating ? "px-6 py-4" : "px-4 py-3"
          }`}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
