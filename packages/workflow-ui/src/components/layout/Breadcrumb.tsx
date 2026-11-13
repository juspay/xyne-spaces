import { cn } from '../shared/cn.js';

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

/** Inline chevron-right SVG used as separator */
function ChevronRight() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path
        d="M4.5 2.5L7.5 6L4.5 9.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  if (!items.length) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex items-center gap-1', className)}
    >
      <ol className="flex items-center gap-1 list-none m-0 p-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={index} className="flex items-center gap-1">
              {/* Separator — not rendered before the first item */}
              {index > 0 && (
                <span
                  className="flex items-center"
                  style={{ color: 'var(--wui-fg-muted)', opacity: 0.4 }}
                  aria-hidden
                >
                  <ChevronRight />
                </span>
              )}

              {isLast ? (
                // Current page — not interactive
                <span
                  className="text-[13px] font-medium select-none"
                  style={{ color: 'var(--wui-fg)' }}
                  aria-current="page"
                >
                  {item.label}
                </span>
              ) : item.onClick ? (
                // Clickable ancestor
                <button
                  type="button"
                  onClick={item.onClick}
                  className={cn(
                    'text-[13px] font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:underline',
                    'hover:underline'
                  )}
                  style={{
                    color: 'var(--wui-fg-muted)',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color =
                      'var(--wui-primary)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color =
                      'var(--wui-fg-muted)';
                  }}
                >
                  {item.label}
                </button>
              ) : (
                // Non-clickable non-last item (edge case)
                <span
                  className="text-[13px] font-medium"
                  style={{ color: 'var(--wui-fg-muted)' }}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
