import React from 'react';
import { cn } from '../shared/cn.js';

export interface SidebarItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}

export interface SidebarProps {
  items: SidebarItem[];
  bottomItems?: SidebarItem[];
  className?: string;
}

/** Abstract geometric logo mark — two overlapping squares rotated 45 deg */
function LogoMark() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Outer diamond */}
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="3"
        fill="none"
        stroke="var(--wui-primary)"
        strokeWidth="1.75"
        transform="rotate(45 12 12) scale(0.72)"
        style={{ transformOrigin: '12px 12px' }}
      />
      {/* Inner filled square */}
      <rect
        x="8"
        y="8"
        width="8"
        height="8"
        rx="1.5"
        fill="var(--wui-primary)"
        transform="rotate(12 12 12)"
        style={{ transformOrigin: '12px 12px' }}
      />
      {/* Corner accent dot */}
      <circle cx="12" cy="4.5" r="1.25" fill="var(--wui-primary)" opacity="0.6" />
    </svg>
  );
}

function NavItem({ item }: { item: SidebarItem }) {
  return (
    <button
      type="button"
      onClick={item.onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-[var(--wui-radius)] px-3 py-2 text-[13px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2',
        item.active
          ? 'text-white'
          : 'text-slate-400 hover:text-slate-200'
      )}
      style={
        item.active
          ? {
              background: 'rgba(255,255,255,0.08)',
              color: '#fff',
            }
          : undefined
      }
    >
      {/* Icon wrapper — fixed 16x16 to keep alignment tight */}
      <span
        className="flex-none"
        style={{
          width: 16,
          height: 16,
          color: item.active ? 'var(--wui-primary)' : 'currentColor',
          opacity: item.active ? 1 : 0.6,
        }}
      >
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>

      {/* Active indicator dot on the right */}
      {item.active && (
        <span
          className="ml-auto flex-none rounded-full"
          style={{
            width: 5,
            height: 5,
            background: 'var(--wui-primary)',
          }}
        />
      )}
    </button>
  );
}

export function Sidebar({ items, bottomItems, className }: SidebarProps) {
  return (
    <nav
      className={cn('flex h-full flex-col', className)}
      style={{ background: '#0C0F14' }}
    >
      {/* ── Logo area ── */}
      <div
        className="flex flex-none items-center gap-3 px-4 py-5"
        style={{ borderBottom: '1px solid var(--wui-border)' }}
      >
        <LogoMark />
        <span
          className="text-[15px] font-semibold tracking-[-0.01em]"
          style={{ color: '#fff', letterSpacing: '-0.01em' }}
        >
          Workflow
        </span>
      </div>

      {/* ── Primary nav items ── */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <ul className="flex flex-col gap-0.5" role="list">
          {items.map((item) => (
            <li key={item.id}>
              <NavItem item={item} />
            </li>
          ))}
        </ul>
      </div>

      {/* ── Bottom items ── */}
      {bottomItems && bottomItems.length > 0 && (
        <div
          className="flex-none px-3 py-3"
          style={{ borderTop: '1px solid var(--wui-border)' }}
        >
          <ul className="flex flex-col gap-0.5" role="list">
            {bottomItems.map((item) => (
              <li key={item.id}>
                <NavItem item={item} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
