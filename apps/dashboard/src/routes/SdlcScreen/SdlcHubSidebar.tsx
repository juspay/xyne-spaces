/**
 * The SDLC sidebar's parts, built to look and behave like Chat's sidebar: the same
 * row height, type, radius and highlight tokens, sections that fold in place and are
 * only as tall as their items, and "+ New …" rows for empty states.
 */
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  PanelLeft,
  Plus,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../utils/classNames';
import { setUserPreference, useUserPreference } from '../../machines/userPreferencesMachine';
import { useScrollFade } from '../../hooks/useScrollFade';
import { AppIcon } from '../../components/AppIcon/AppIcon';
import { ActivityPill, type SdlcLiveCalls } from './ActivityPill';

export interface SdlcHubOption {
  id: string;
  name: string;
  visibility: string;
}

/** Chat's sidebar row: 36px, 14px type, 10px radius, the sidebar accent for hover and active. */
export const sdlcSidebarRowClass = (active: boolean, muted = false): string =>
  cn(
    'flex h-9 w-full items-center gap-3 rounded-[10px] border border-transparent px-3 text-sm transition-colors',
    active
      ? 'border-sidebar-border bg-sidebar-accent font-medium text-sidebar-accent-foreground'
      : cn(
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          muted ? 'text-sidebar-foreground/60' : 'text-sidebar-foreground',
        ),
  );

/** The row's icon slot, sized like Chat's. */
export function SdlcSidebarRowIcon(props: {
  icon: LucideIcon;
  appIcon?: string | null | undefined;
}): ReactElement {
  const Icon = props.icon;
  return (
    <span className='flex size-4 shrink-0 items-center justify-center'>
      {props.appIcon ? (
        <AppIcon name={props.appIcon} size={16} aria-hidden='true' />
      ) : (
        <Icon className='size-4' />
      )}
    </span>
  );
}

interface SdlcSidebarRowProps {
  icon: LucideIcon;
  /** A chosen @xyne/icons name, shown in place of `icon`. */
  appIcon?: string | null | undefined;
  label: string;
  active?: boolean;
  /** Top-level navigation reads medium weight, as Chat's Threads and Unreads do. */
  emphasis?: boolean;
  muted?: boolean;
  /** Shown only when there is something to count. */
  count?: number | undefined;
  /** Calls in progress on it, or anywhere under it: one pill counts them all. */
  liveCalls?: SdlcLiveCalls | undefined;
  title?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  trackName: string;
  trackMetadata?: Record<string, unknown>;
}

export function SdlcSidebarRow(props: SdlcSidebarRowProps): ReactElement {
  const active = props.active ?? false;
  return (
    <button
      type='button'
      onClick={props.onClick}
      {...(active && { 'aria-current': 'page' as const })}
      {...(props.title !== undefined && { title: props.title })}
      className={cn(
        sdlcSidebarRowClass(active, props.muted),
        props.emphasis && 'font-medium tracking-[-0.14px]',
      )}
      data-track-category='SdlcHub'
      data-track-name={props.trackName}
      {...(props.trackMetadata && { 'data-track-metadata': JSON.stringify(props.trackMetadata) })}
    >
      <SdlcSidebarRowIcon icon={props.icon} appIcon={props.appIcon} />
      <span className='min-w-0 flex-1 truncate text-left'>{props.label}</span>
      <ActivityPill live={props.liveCalls} rollUp place={props.label} size='sm' />
      {props.count !== undefined && props.count > 0 && (
        <span className='shrink-0 text-xs tabular-nums text-sidebar-foreground/50'>
          {props.count}
        </span>
      )}
    </button>
  );
}

/** Chat's "+ Add" row, for a section with nothing in it yet. */
export function SdlcSidebarAddRow(props: {
  label: string;
  onClick: () => void;
  trackName: string;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={props.onClick}
      className='flex h-9 w-full items-center gap-3 rounded-[10px] border border-dashed border-transparent px-3 text-sm text-sidebar-foreground/60 transition-colors hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      data-track-category='SdlcHub'
      data-track-name={props.trackName}
    >
      <span className='flex size-4 shrink-0 items-center justify-center'>
        <Plus className='size-4' />
      </span>
      <span className='min-w-0 flex-1 truncate text-left'>{props.label}</span>
    </button>
  );
}

function toggleSection(collapsedSections: Record<string, boolean>, id: string): void {
  setUserPreference('sdlcSidebarSectionsCollapsed', {
    ...collapsedSections,
    [id]: !(collapsedSections[id] ?? false),
  });
}

/**
 * A list that scrolls without a scrollbar, fading at an edge only while there is more
 * past it — so a row cut off at the bottom reads as "more below", not as clipped.
 */
function FadingList(props: { children: ReactNode }): ReactElement {
  const fade = useScrollFade<HTMLDivElement>('y');
  return (
    <div
      ref={fade.ref}
      onScroll={fade.onScroll}
      className='no-scrollbar min-h-0 overflow-y-auto'
      style={fade.style}
    >
      <div>{props.children}</div>
    </div>
  );
}

const SECTION_HEADER_HEIGHT = 32;
const SECTION_ROW_HEIGHT = 36;
/** Rows a section keeps in view when the sections together don't fit. */
const SECTION_MIN_ROWS = 3;

/**
 * A list section: a heading that folds it, then its rows. Sections share the sidebar's
 * height. Each is as tall as its rows, so an empty one takes no room; once they don't
 * all fit, each scrolls on its own and keeps at least SECTION_MIN_ROWS rows in view, so
 * a long list can't push the next section off screen and every heading stays visible.
 * Whether it is folded is remembered per device.
 *
 * The heading is set apart from the rows under it — a chevron rather than an item icon,
 * smaller muted semibold type and a count — so it reads as the list's title.
 */
export function SdlcSidebarGroup(props: {
  id: string;
  title: string;
  count?: number;
  /** How many rows it shows: the height it keeps when space runs short. */
  rows: number;
  action?: { label: string; onClick: () => void; trackName: string };
  children: ReactNode;
}): ReactElement {
  const collapsedSections = useUserPreference('sdlcSidebarSectionsCollapsed');
  const collapsed = collapsedSections[props.id] ?? false;
  const minHeight =
    SECTION_HEADER_HEIGHT + Math.min(props.rows, SECTION_MIN_ROWS) * SECTION_ROW_HEIGHT;
  return (
    <section
      id={props.id}
      aria-label={props.title}
      className={cn('flex flex-col', collapsed ? 'shrink-0' : 'shrink')}
      {...(!collapsed && { style: { minHeight } })}
    >
      <div className='group flex h-8 shrink-0 items-center gap-1 pl-3 pr-1'>
        <button
          type='button'
          onClick={() => toggleSection(collapsedSections, props.id)}
          aria-expanded={!collapsed}
          className='flex h-full min-w-0 flex-1 items-center gap-1.5 text-[13px] font-semibold text-sidebar-foreground/70 transition-colors hover:text-sidebar-accent-foreground focus:outline-none focus-visible:text-sidebar-accent-foreground'
          data-track-category='SdlcHub'
          data-track-name='SidebarSectionToggled'
          data-track-metadata={JSON.stringify({ section: props.id })}
        >
          <ChevronRight
            strokeWidth={2.5}
            size={12}
            className={cn('shrink-0 transition-transform duration-200', !collapsed && 'rotate-90')}
          />
          <span className='truncate text-left'>{props.title}</span>
          {props.count !== undefined && props.count > 0 && (
            <span className='shrink-0 rounded-md bg-sidebar-accent px-1.5 py-px text-[11px] font-medium tabular-nums text-sidebar-foreground/70'>
              {props.count}
            </span>
          )}
        </button>
        {props.action && (
          <button
            type='button'
            onClick={props.action.onClick}
            title={props.action.label}
            aria-label={props.action.label}
            className='flex shrink-0 items-center justify-center rounded-md p-1 text-sidebar-foreground opacity-0 transition-opacity duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus:outline-none focus-visible:opacity-100 group-hover:opacity-100'
            data-track-category='SdlcHub'
            data-track-name={props.action.trackName}
          >
            <Plus size={14} className='shrink-0' />
          </button>
        )}
      </div>
      {!collapsed && <FadingList>{props.children}</FadingList>}
    </section>
  );
}

const HEADER_ICON_BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring';

/**
 * The sidebar's title row, in the place of Chat's "Inbox": the hub's name, which opens
 * the hub switcher, and adding people to the hub. The collapse toggle leads, so peeking
 * at a folded sidebar puts it under the pointer and one click pins it open; folded, it
 * is all the row shows.
 */
export function SdlcHubHeader(props: {
  open: boolean;
  collapsed: boolean;
  hubName: string;
  onToggleRail: () => void;
  onOpenSwitcher: () => void;
  onAddMembers: () => void;
}): ReactElement {
  const toggle = (
    <button
      type='button'
      onClick={props.onToggleRail}
      title={props.collapsed ? 'Pin the sidebar open' : 'Collapse to icons'}
      aria-label={props.collapsed ? 'Pin the sidebar open' : 'Collapse to icons'}
      className={cn(HEADER_ICON_BUTTON, 'text-sidebar-foreground/60')}
      data-track-category='SdlcHub'
      data-track-name='SidebarRailToggled'
    >
      <PanelLeft className='size-4' />
    </button>
  );

  if (!props.open) {
    return <div className='mb-2 flex h-10 shrink-0 items-center justify-center'>{toggle}</div>;
  }

  // The toggle's icon sits in the rows' icon column below it.
  return (
    <div className='mb-2 flex h-10 shrink-0 items-center gap-0.5 pl-2'>
      {toggle}
      <button
        type='button'
        onClick={props.onOpenSwitcher}
        title={`${props.hubName} · Switch hub (⌘J)`}
        className='flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg px-1.5 text-left transition-colors hover:bg-sidebar-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-accent-ring'
        data-track-category='SdlcHub'
        data-track-name='HubSwitcherOpened'
        data-track-metadata={JSON.stringify({ via: 'title' })}
      >
        <span className='min-w-0 truncate text-base font-semibold leading-normal text-sidebar-accent-foreground'>
          {props.hubName}
        </span>
        <ChevronDown className='size-3.5 shrink-0 text-sidebar-foreground/60' />
      </button>
      <button
        type='button'
        onClick={props.onAddMembers}
        title='Add members'
        aria-label='Add members'
        className={HEADER_ICON_BUTTON}
        data-track-category='SdlcHub'
        data-track-name='HeaderMembersClicked'
        data-track-metadata={JSON.stringify({ place: 'hub-header' })}
      >
        <UserPlus className='size-4' />
      </button>
    </div>
  );
}
