/**
 * ShellV3 — global app shell: top command rail + collapsible sidebar.
 *
 * Sidebar:
 *   - Expanded (200px): icon + label + group headers
 *   - Collapsed (52px):  icon only; hover → group flyout panel to the right
 *   - State persisted to localStorage
 *
 * Bottom footer:
 *   - Avatar / name
 *   - Theme toggle button (always visible, labelled)
 *   - Logout button (always visible, labelled)
 */

import React, { useState, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  HouseIcon,
  RobotIcon,
  PlugsConnectedIcon,
  WrenchIcon,
  TreeStructureIcon,
  ShareNetworkIcon,
  GitBranchIcon,
  GearSixIcon,
  SparkleIcon,
  PaintBrushIcon,
  ChartBarIcon,
  BrainIcon,
  FlaskIcon,
  MagnifyingGlassIcon,
  PulseIcon,
  TagIcon,
  ShieldCheckIcon,
  BuildingsIcon,
  SignOutIcon,
  SunIcon,
  MoonIcon,
  CaretLeftIcon,
  CaretRightIcon,
  DotsThreeVerticalIcon,
  ArrowUUpLeftIcon,
} from "@phosphor-icons/react";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { Avatar } from "./components/ui/Avatar";
import { Badge } from "./components/ui/Badge";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface ShellV3Props {
  children: React.ReactNode;
  /** When true, the Admin nav item is appended to the sidebar. */
  isAdmin?: boolean;
  /** CLAW_ADMIN or the narrower SEARCH_EVAL_ACCESS role — gates the Search Evals nav item independently of Evals/Admin. */
  hasSearchEvalAccess?: boolean;
}

type PhosphorWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

type IconComponent = React.ComponentType<{
  size?: number;
  className?: string;
  weight?: PhosphorWeight;
}>;

interface RailDestination {
  label: string;
  path: string;
  icon: IconComponent;
}

interface SidebarItemConfig {
  label: string;
  path: string;
  icon: IconComponent;
  count?: number;
}

interface SidebarGroupConfig {
  label?: string;
  items: SidebarItemConfig[];
}

interface FlyoutState {
  groupLabel?: string;
  groupItems: SidebarItemConfig[];
  anchorY: number; // center Y of the hovered item in viewport coords
}

/* ── Config ────────────────────────────────────────────────────────── */

const RAIL_DESTINATIONS: RailDestination[] = [
  { label: "Chat with agents", path: "/v3/chat",     icon: SparkleIcon },
  { label: "Design",          path: "/v3/design",   icon: PaintBrushIcon },
  { label: "Dashboard",    path: "/v3/dashboard",    icon: ChartBarIcon },
  { label: "Digital Twin", path: "/v3/digital-twin", icon: BrainIcon },
  // Escape hatch to the legacy V1 surface. Lives in the top rail
  // alongside the primary destinations so users can flip back at any
  // moment. Path is `/v1` — kept reachable in App.tsx purely for this
  // affordance (root `/` redirects to /v3/home now that V3 is main).
  { label: "Switch to v1", path: "/v1",              icon: ArrowUUpLeftIcon },
];

const SIDEBAR_GROUPS: SidebarGroupConfig[] = [
  {
    items: [
      { label: "Home", path: "/v3/home", icon: HouseIcon },
    ],
  },
  {
    label: "Build",
    items: [
      { label: "Agents",    path: "/v3/agents",    icon: RobotIcon },
      { label: "MCPs",          path: "/v3/mcp",       icon: PlugsConnectedIcon },
      { label: "Skills",       path: "/v3/skills",    icon: WrenchIcon },
      { label: "Subagents",  path: "/v3/subagents", icon: TreeStructureIcon },
      { label: "Channels",     path: "/v3/gateways",  icon: ShareNetworkIcon },
      { label: "Workflows", path: "/v3/workflows", icon: GitBranchIcon },
    ],
  },
  {
    label: "Observe",
    items: [
      { label: "Metrics", path: "/v3/metrics", icon: ChartBarIcon },
      { label: "Evals", path: "/v3/evals", icon: FlaskIcon },
      { label: "Search Evals", path: "/v3/search-evals", icon: MagnifyingGlassIcon },
      { label: "Error Pipeline", path: "/v3/error-pipeline", icon: PulseIcon },
      { label: "Entity Types", path: "/v3/entity-types", icon: TagIcon },
    ],
  },
  {
    label: "Configure",
    items: [
      { label: "Organization", path: "/v3/organizations", icon: BuildingsIcon },
      { label: "Settings", path: "/v3/settings", icon: GearSixIcon },
      { label: "Digital Twin Users", path: "/v3/configurations/digital-twin", icon: BrainIcon },
    ],
  },
];

const ADMIN_GROUP: SidebarGroupConfig = {
  label: "Admin",
  items: [{ label: "Admin", path: "/v3/admin", icon: ShieldCheckIcon }],
};

/* ── Sub-components ────────────────────────────────────────────────── */

function RailTab({
  item,
  isActive,
  onClick,
}: {
  item: RailDestination;
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    /* Prominent primary-nav tab.
       Earlier the inactive state used `text-xyne-fg-tertiary` + regular-
       weight icons, which read as decorative chrome rather than navigation
       — users missed Studio / Dashboard / Digital Twin on first glance.
       Now:
         - Inactive sits at `text-xyne-fg-secondary` with bold-weight icons,
           so each tab is unmistakably a clickable destination at rest.
         - Active flips to a solid `bg-xyne-fg-primary` pill with inverse
           text — strong, unambiguous "I'm here" signal that survives any
           background underneath the top bar.
         - Slightly larger icon (18) and text (13px/semibold) push the cluster
           into "primary nav" territory rather than secondary chrome. */
    <button
      type="button"
      onClick={onClick}
      data-id={`rail-item-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
      className={`group relative flex items-center gap-[8px] px-[14px] h-[36px] rounded-[10px] cursor-pointer transition-all select-none font-sans ${
        isActive
          ? "bg-xyne-fg-primary text-xyne-fg-inverse shadow-sm"
          : "text-xyne-fg-secondary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
      }`}
    >
      <Icon
        size={18}
        weight={isActive ? "fill" : "bold"}
        className="shrink-0"
      />
      <span className="text-[13px] font-semibold leading-none whitespace-nowrap tracking-[-0.1px]">
        {item.label}
      </span>
    </button>
  );
}

function SidebarNavItem({
  label,
  icon: Icon,
  count,
  isActive,
  collapsed,
  onClick,
  onHoverIn,
  onHoverOut,
}: {
  label: string;
  icon: IconComponent;
  count?: number;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
  onHoverIn?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onHoverOut?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={collapsed ? onHoverIn : undefined}
      onMouseLeave={collapsed ? onHoverOut : undefined}
      data-id={`sidebar-nav-item-${label.toLowerCase()}`}
      className={`relative flex w-full items-center rounded-md text-left transition-colors ${
        collapsed ? "justify-center px-0 py-[9px]" : "gap-2.5 px-3 py-2"
      } ${
        isActive
          ? "bg-xyne-surface font-medium text-xyne-fg-primary shadow-sm dark:bg-xyne-surface-sunken"
          : "text-xyne-fg-tertiary hover:bg-xyne-surface/70 hover:text-xyne-fg-primary dark:hover:bg-xyne-surface-sunken/70"
      }`}
    >
      {/* Active accent bar — collapsed only */}
      {collapsed && isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-r-full bg-xyne-brand" />
      )}
      <Icon size={15} weight={isActive ? "fill" : "regular"} />
      {!collapsed && <span className="flex-1 truncate text-[14px]">{label}</span>}
      {!collapsed && count !== undefined && count > 0 && (
        <Badge as="span" label={String(count)} variant="neutral" size="sm" />
      )}
    </button>
  );
}

/* ── Sidebar Flyout ────────────────────────────────────────────────── */

function SidebarFlyout({
  flyout,
  pathname,
  onNavigate,
  onMouseEnter,
  onMouseLeave,
}: {
  flyout: FlyoutState;
  pathname: string;
  onNavigate: (path: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  // Clamp top so flyout stays inside viewport
  const estHeight = (flyout.groupLabel ? 28 : 0) + flyout.groupItems.length * 34 + 12;
  const rawTop = flyout.anchorY - estHeight / 2;
  const top = Math.max(68, Math.min(rawTop, window.innerHeight - estHeight - 8));

  return (
    <div
      style={{ top, animation: "flyoutIn 0.14s cubic-bezier(0.22,1,0.36,1) both" } as React.CSSProperties}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed left-[64px] z-50 min-w-[168px] rounded-[12px] bg-white dark:bg-xyne-surface border border-xyne-border shadow-[0_8px_28px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] py-[6px] overflow-hidden"
    >
      {flyout.groupLabel && (
        <div className="px-[12px] pt-[4px] pb-[6px] text-[10px] font-semibold uppercase tracking-[0.08em] text-xyne-fg-tertiary">
          {flyout.groupLabel}
        </div>
      )}
      <div className="flex flex-col">
        {flyout.groupItems.map((item) => {
          const isActive = pathname.startsWith(item.path);
          const ItemIcon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => onNavigate(item.path)}
              className={`flex items-center gap-[9px] px-[12px] py-[7px] text-left text-[13px] transition-colors ${
                isActive
                  ? "bg-xyne-surface-sunken text-xyne-fg-primary font-medium"
                  : "text-xyne-fg-secondary hover:bg-xyne-surface-sunken/60 hover:text-xyne-fg-primary"
              }`}
            >
              <ItemIcon
                size={13}
                weight={isActive ? "fill" : "regular"}
                className="flex-shrink-0 text-xyne-fg-tertiary"
              />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── ShellV3 ───────────────────────────────────────────────────────── */

export function ShellV3({ children, isAdmin = false, hasSearchEvalAccess = false }: ShellV3Props) {
  // Admin section appended only for users with CLAW_ADMIN. Evals stays
  // CLAW_ADMIN-only; Search Evals additionally opens up to the narrower
  // SEARCH_EVAL_ACCESS grant (isAdmin implies hasSearchEvalAccess too).
  const sidebarGroups: SidebarGroupConfig[] = (isAdmin
    ? [...SIDEBAR_GROUPS, ADMIN_GROUP]
    : SIDEBAR_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => {
          if (i.path === "/v3/search-evals") return hasSearchEvalAccess;
          return i.path !== "/v3/evals"
            && i.path !== "/v3/entity-types"
            && i.path !== "/v3/configurations/digital-twin";
        }),
      }))
  ).filter((g) => g.items.length > 0);
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("xyne_sidebar_collapsed") === "true"; }
    catch { return false; }
  });

  const [flyout, setFlyout] = useState<FlyoutState | null>(null);
  const flyoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFlyoutTimer = () => {
    if (flyoutTimerRef.current) {
      clearTimeout(flyoutTimerRef.current);
      flyoutTimerRef.current = null;
    }
  };

  const handleItemHoverIn = useCallback(
    (path: string, e: React.MouseEvent<HTMLButtonElement>) => {
      clearFlyoutTimer();
      const group = sidebarGroups.find((g) => g.items.some((i) => i.path === path));
      if (!group) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setFlyout({
        groupLabel: group.label,
        groupItems: group.items,
        anchorY: rect.top + rect.height / 2,
      });
    },
    [sidebarGroups],
  );

  const handleItemHoverOut = useCallback(() => {
    flyoutTimerRef.current = setTimeout(() => setFlyout(null), 140);
  }, []);

  const handleFlyoutEnter = useCallback(() => { clearFlyoutTimer(); }, []);
  const handleFlyoutLeave = useCallback(() => { setFlyout(null); }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("xyne_sidebar_collapsed", String(next)); } catch {}
      if (!next) setFlyout(null);
      return next;
    });
  };

  if (auth.status !== "authenticated") {
    return <>{children}</>;
  }

  const user = auth.user;
  const pathname = location.pathname;

  const isRailActive = (_label: string, path: string) => pathname.startsWith(path);

  return (
    <>
      {/* Flyout animation keyframe injected once */}
      <style>{`
        @keyframes flyoutIn {
          from { opacity: 0; transform: translateX(-6px) scale(0.97); }
          to   { opacity: 1; transform: translateX(0)    scale(1); }
        }
      `}</style>

      <div
        data-id="app-shell"
        className="flex h-screen flex-col overflow-hidden bg-xyne-surface-subtle"
      >
        {/* ═══════════════ ZONE 1 — TOP COMMAND RAIL ═══════════════ */}
        <header
          data-id="top-rail"
          className="h-[60px] flex items-center justify-between px-[24px] bg-xyne-surface border-b border-xyne-border shrink-0 w-full"
        >
          {/* Left: branding */}
          <div className="flex items-center gap-[10px] shrink-0 select-none">
            <div
              data-id="brand-mark"
              className="flex items-center justify-center w-[28px] h-[28px] rounded-[8px] bg-xyne-brand text-xyne-fg-inverse shadow-[0_1px_2px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.08)]"
              aria-hidden="true"
            >
              <span className="text-[15px] font-bold tracking-[-0.5px] leading-none">X</span>
            </div>
            <div className="flex items-baseline gap-[5px]">
              <span className="text-[17px] font-bold text-xyne-fg-primary tracking-[-0.45px] leading-none">Xyne</span>
              <span className="text-[17px] font-normal text-xyne-fg-tertiary tracking-[-0.3px] leading-none">Claw</span>
            </div>
          </div>

          {/* Right: nav tabs */}
          <nav className="flex items-center gap-[4px]">
            {RAIL_DESTINATIONS.map((item) => (
              <RailTab
                key={item.path}
                item={item}
                isActive={isRailActive(item.label, item.path)}
                onClick={() => navigate(item.path)}
              />
            ))}
          </nav>
        </header>

        {/* ═══════════════ ZONE 2 — SIDEBAR + MAIN ═══════════════ */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Sidebar ── */}
          <aside
            data-id="sidebar"
            className={`flex h-full shrink-0 flex-col bg-xyne-surface-subtle text-[14px] transition-[width] duration-200 overflow-hidden ${
              collapsed ? "w-[52px]" : "w-[200px]"
            }`}
          >
            {/* ── Profile header ── */}
            {collapsed ? (
              /* Collapsed: single three-dots button — click to expand */
              <div className="flex justify-center py-[10px] border-b border-xyne-border-subtle">
                <button
                  onClick={toggleCollapsed}
                  title={`${user.name} — click to expand`}
                  className="w-[28px] h-[28px] flex items-center justify-center rounded-[6px] text-xyne-fg-muted hover:bg-xyne-surface hover:text-xyne-fg-secondary transition-colors"
                >
                  <DotsThreeVerticalIcon size={16} weight="bold" />
                </button>
              </div>
            ) : (
              /* Expanded: avatar + name + theme icon + collapse arrow inline */
              <div className="flex items-center gap-[6px] px-[12px] pt-[14px] pb-[10px] border-b border-xyne-border-subtle">
                <Avatar name={user.name} size={26} shape="circle" />
                <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-xyne-fg-primary">
                  {user.name}
                </span>
                <button
                  onClick={toggleTheme}
                  title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                  className="w-[26px] h-[26px] flex items-center justify-center rounded-[6px] text-xyne-fg-muted hover:bg-xyne-surface hover:text-xyne-fg-primary transition-colors flex-shrink-0"
                >
                  {theme === "light" ? <MoonIcon size={13} /> : <SunIcon size={13} />}
                </button>
                <button
                  onClick={toggleCollapsed}
                  title="Collapse sidebar"
                  className="w-[26px] h-[26px] flex items-center justify-center rounded-[6px] text-xyne-fg-muted hover:bg-xyne-surface hover:text-xyne-fg-secondary transition-colors flex-shrink-0"
                >
                  <CaretLeftIcon size={12} />
                </button>
              </div>
            )}

            {/* Nav groups */}
            <div className={`space-y-3 py-[10px] ${collapsed ? "px-1" : "px-2"}`}>
              {sidebarGroups.map((group, groupIdx) => (
                <div key={group.label ?? `group-${groupIdx}`}>
                  {/* Group label or divider */}
                  {group.label && !collapsed && (
                    <div className="mb-1 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
                      {group.label}
                    </div>
                  )}
                  {group.label && collapsed && (
                    <div className="mb-1 h-px bg-xyne-border-subtle mx-1" />
                  )}
                  <div className="space-y-0.5">
                    {group.items.map(({ label, path, icon, count }) => (
                      <SidebarNavItem
                        key={path}
                        label={label}
                        icon={icon}
                        count={count}
                        isActive={pathname.startsWith(path)}
                        collapsed={collapsed}
                        onClick={() => { navigate(path); setFlyout(null); }}
                        onHoverIn={collapsed ? (e) => handleItemHoverIn(path, e) : undefined}
                        onHoverOut={collapsed ? handleItemHoverOut : undefined}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* ── Footer: logout only ── */}
            <div className={`border-t border-xyne-border-subtle ${collapsed ? "px-[8px] py-[8px] flex justify-center" : "px-[8px] py-[6px]"}`}>
              {collapsed ? (
                <button
                  onClick={auth.logout}
                  title="Log out"
                  className="w-[28px] h-[28px] flex items-center justify-center rounded-[6px] text-xyne-fg-tertiary hover:bg-xyne-surface hover:text-xyne-error transition-colors"
                >
                  <SignOutIcon size={14} />
                </button>
              ) : (
                <button
                  onClick={auth.logout}
                  className="flex w-full items-center gap-[8px] rounded-[6px] px-[8px] py-[6px] text-[12px] text-xyne-fg-secondary hover:bg-xyne-surface hover:text-xyne-error transition-colors"
                >
                  <SignOutIcon size={13} className="shrink-0" />
                  Log out
                </button>
              )}
            </div>
          </aside>

          {/* ── Group flyout (fixed, escapes aside overflow:hidden) ── */}
          {collapsed && flyout && (
            <SidebarFlyout
              flyout={flyout}
              pathname={pathname}
              onNavigate={(path) => { navigate(path); setFlyout(null); }}
              onMouseEnter={handleFlyoutEnter}
              onMouseLeave={handleFlyoutLeave}
            />
          )}

          {/* Main content */}
          <main
            data-id="app-main-content"
            className="m-2 flex flex-1 flex-row gap-2 overflow-hidden"
          >
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
