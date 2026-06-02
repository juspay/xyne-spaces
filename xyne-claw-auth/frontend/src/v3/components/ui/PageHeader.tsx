import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional actions (buttons, menus) pinned to the right */
  actions?: ReactNode;
  /** Optional decorative icon rendered to the left of the title */
  icon?: ReactNode;
}

/**
 * Shared page header used across all v3 modules.
 * Padding is controlled by --spacing-xyne-header (20px) via p-xyne-header.
 * Colors come from Tier-2 semantic tokens: xyne-fg-primary, xyne-fg-muted, xyne-border-subtle.
 */
export function PageHeader({ title, description, actions, icon }: PageHeaderProps) {
  return (
    <div
      data-id="page-header"
      className="shrink-0 border-b border-xyne-border-subtle p-xyne-header"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {icon && (
            <span
              data-id="page-header-icon"
              className="mt-0.5 inline-flex shrink-0 items-center justify-center"
            >
              {icon}
            </span>
          )}
          <div>
            <h1
              data-id="page-header-title"
              className="text-xl font-semibold text-xyne-fg-primary"
            >
              {title}
            </h1>
            {description && (
              <p
                data-id="page-header-description"
                className="mt-1 text-[14px] text-xyne-fg-muted"
              >
                {description}
              </p>
            )}
          </div>
        </div>

        {actions && (
          <div data-id="page-header-actions" className="shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
