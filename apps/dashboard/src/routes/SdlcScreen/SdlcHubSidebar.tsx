import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Hash,
  Lock,
  Plus,
  Settings2,
} from 'lucide-react';
import { Panel, Separator, usePanelRef } from '../../components/ui/Resizable/Resizable';
import { cn } from '../../utils/classNames';
import {
  setUserPreference,
  useUserPreference,
  userPreferencesSnapshot,
} from '../../machines/userPreferencesMachine';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import { Popover } from '../../components/ui/Popover';

/** Header height, and therefore the height a collapsed section folds down to. */
const SECTION_HEADER_HEIGHT = 28;
/** Height a section opens to when neither the reader nor the caller has said. */
const DEFAULT_SECTION_HEIGHT = 170;
/** Least an open section may be squeezed to — enough to be worth having open. */
const MIN_OPEN_SECTION_HEIGHT = 150;
/** Height of a drag handle. The sections share what is left after these. */
const SECTION_SEPARATOR_HEIGHT = 7;
/**
 * The resizable sections, in the order they appear, with the height each opens
 * to before the reader drags it anywhere. They live here rather than at the call
 * site because working out one section's height needs all of them: the space is
 * shared, so the answer is a layout, not four independent decisions.
 */
export const SDLC_SECTIONS: ReadonlyArray<{ id: string; defaultHeight: number }> = [
  { id: 'sdlc-sidebar-hub', defaultHeight: 180 },
  { id: 'sdlc-sidebar-tracks', defaultHeight: 200 },
  { id: 'sdlc-sidebar-artifacts', defaultHeight: 180 },
  { id: 'sdlc-sidebar-repositories', defaultHeight: 180 },
];

export interface SdlcHubRepository {
  id: string;
  name: string;
  url: string;
  canonicalUrl?: string | null;
}

export interface SdlcHubOption {
  id: string;
  name: string;
  visibility: string;
  repositories: SdlcHubRepository[];
}

function repositoryHref(repository: SdlcHubRepository): string {
  return repository.canonicalUrl || repository.url;
}

/**
 * Hub switcher. Repository names ride in the subtitle, which the selector
 * searches — and they need room, so the dropdown is left to size itself to its
 * content rather than being pinned to the trigger's sidebar-narrow width.
 */
export function SdlcHubPicker(props: {
  hubs: SdlcHubOption[];
  selectedHubId: string;
  onSelect: (hubId: string) => void;
}): ReactElement {
  const options = useMemo<SelectorOption[]>(
    () =>
      props.hubs.map(hub => ({
        value: hub.id,
        label: hub.name,
        subtitle:
          hub.repositories.map(repository => repository.name).join(', ') || 'No repositories',
        // Channel semantics: a lock for private, a hash for public.
        icon:
          hub.visibility === 'PUBLIC' ? (
            <Hash className='size-4 text-muted-foreground' />
          ) : (
            <Lock className='size-4 text-muted-foreground' />
          ),
      })),
    [props.hubs],
  );

  return (
    <EntitySelector
      options={options}
      selectedValue={props.selectedHubId}
      onSelect={value => {
        if (value) props.onSelect(value);
      }}
      placeholder='Select hub'
      searchPlaceholder='Search hubs and repositories...'
      width='100%'
      dropdownMinWidth='22rem'
    />
  );
}

/** The hub's repositories, each opening in a new tab. */
export function SdlcHubRepositories(props: {
  repositories: SdlcHubRepository[];
  onManage: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const count = props.repositories.length;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side='top'
      align='start'
      sideOffset={6}
      className='w-[260px] p-0'
      trigger={
        <button
          type='button'
          className='flex w-full items-center gap-2 rounded-lg px-2 py-2 font-medium transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent-ring'
          aria-label='Repositories in this hub'
          data-track-category='SdlcHub'
          data-track-name='HubRepositoryListOpened'
        >
          <GitBranch className='size-4 shrink-0 text-sidebar-foreground/65' />
          <span className='min-w-0 flex-1 truncate text-left'>Repositories</span>
          <span className='shrink-0 text-[11px] tabular-nums text-sidebar-foreground/55'>
            {count}
          </span>
          <ChevronRight className='size-3.5 shrink-0 text-sidebar-foreground/55' />
        </button>
      }
    >
      <div className='max-h-72 overflow-y-auto py-1'>
        {count === 0 ? (
          <p className='px-3 py-4 text-center text-xs text-muted-foreground'>
            No repositories in this hub.
          </p>
        ) : (
          props.repositories.map(repository => (
            <a
              key={repository.id}
              href={repositoryHref(repository)}
              target='_blank'
              rel='noreferrer'
              className='flex items-center gap-2 px-2.5 py-2 transition-colors hover:bg-muted/60'
              data-track-category='SdlcHub'
              data-track-name='HubRepositoryOpened'
            >
              <GitBranch className='size-3.5 shrink-0 text-muted-foreground' />
              <span className='min-w-0 flex-1 truncate text-[12.5px]'>{repository.name}</span>
              <ExternalLink className='size-3 shrink-0 text-muted-foreground' />
            </a>
          ))
        )}
      </div>
      <button
        type='button'
        className='flex w-full items-center gap-2 border-t px-2.5 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground'
        onClick={() => {
          setOpen(false);
          props.onManage();
        }}
        data-track-category='SdlcHub'
        data-track-name='HubRepositoriesOpened'
      >
        <Settings2 className='size-3.5' />
        Manage repositories
      </button>
    </Popover>
  );
}

/**
 * How tall each section should be, given the space there is and what the reader
 * has asked for.
 *
 * When the stored heights fit, they are used as-is. When they do not — a height
 * Whatever is open fills the sidebar between the folded headers, sharing the room
 * in proportion to the heights asked for. Sections are not left at a height that
 * strands empty space below the last one — a folded header belongs against the
 * section under it, not floating with a gap beneath. Only when every section is
 * folded do the headers stack and the space below them go unused.
 *
 * Each open section is first given enough to look open, so none is ever squeezed
 * to its header while its chevron points open, and a sidebar too short for what
 * was asked for shrinks everything a little rather than starving whichever
 * sections happen to come last.
 */
export function sdlcSectionLayout(
  groupHeight: number,
  collapsedSections: Record<string, boolean>,
  sectionHeights: Record<string, number>,
): Record<string, number> {
  const heights: Record<string, number> = {};
  for (const section of SDLC_SECTIONS) {
    if (collapsedSections[section.id]) heights[section.id] = SECTION_HEADER_HEIGHT;
  }
  const open = SDLC_SECTIONS.filter(section => !collapsedSections[section.id]);
  if (open.length === 0) return heights;

  // The drag handles between the sections take height too. Leaving them out
  // scaled every section up by the few percent they occupy, which is a visible
  // jump the moment a drag ends and the layout is reapplied.
  const available =
    groupHeight -
    (SDLC_SECTIONS.length - 1) * SECTION_SEPARATOR_HEIGHT -
    (SDLC_SECTIONS.length - open.length) * SECTION_HEADER_HEIGHT;
  if (available <= 0) {
    for (const section of open) heights[section.id] = SECTION_HEADER_HEIGHT;
    return heights;
  }

  const wanted = new Map(
    open.map(section => [
      section.id,
      Math.max(MIN_OPEN_SECTION_HEIGHT, sectionHeights[section.id] ?? section.defaultHeight),
    ]),
  );
  const wantedTotal = open.reduce((total, section) => total + (wanted.get(section.id) ?? 0), 0);

  // When what the reader asked for fits, they get exactly that, and the last open
  // section takes up whatever is left over. Sharing the slack across all of them
  // instead meant folding one section resized every other one, so the whole
  // sidebar shifted under the pointer to open a single list.
  if (wantedTotal <= available) {
    const last = open[open.length - 1];
    open.forEach(section => {
      heights[section.id] = wanted.get(section.id) ?? section.defaultHeight;
    });
    if (last) heights[last.id] = (heights[last.id] ?? 0) + (available - wantedTotal);
    return heights;
  }

  // Too tall to fit: everything shrinks a little, in proportion. Straight scaling,
  // so heights that already fill the sidebar map to themselves — anything that
  // reshuffles them gives a different answer each time it runs over its own
  // output, which walks the sections further on every collapse and snaps them
  // away from where a drag just put them.
  const settled = new Map<string, number>();
  let pool = [...open];
  let remaining = available;
  for (;;) {
    const poolTotal = pool.reduce((total, section) => total + (wanted.get(section.id) ?? 0), 0);
    if (poolTotal <= 0) {
      for (const section of pool) settled.set(section.id, remaining / pool.length);
      break;
    }
    // A section too small to read as open takes its minimum off the top; the rest
    // then share what is left, which may push another below the line in turn.
    const starved = pool.filter(
      section => ((wanted.get(section.id) ?? 0) / poolTotal) * remaining < MIN_OPEN_SECTION_HEIGHT,
    );
    if (starved.length === 0) {
      for (const section of pool) {
        settled.set(section.id, ((wanted.get(section.id) ?? 0) / poolTotal) * remaining);
      }
      break;
    }
    for (const section of starved) {
      settled.set(section.id, MIN_OPEN_SECTION_HEIGHT);
      remaining -= MIN_OPEN_SECTION_HEIGHT;
    }
    pool = pool.filter(section => !starved.includes(section));
    if (pool.length === 0) break;
  }

  // Round so the sections still add up to exactly the space there is — otherwise
  // the leftover pixel lands somewhere on its own and the layout creeps.
  let used = 0;
  open.forEach((section, index) => {
    const exact = settled.get(section.id) ?? MIN_OPEN_SECTION_HEIGHT;
    const height = index === open.length - 1 ? available - used : Math.round(exact);
    heights[section.id] = height;
    used += height;
  });
  return heights;
}

/**
 * One collapsible, vertically resizable list in the hub sidebar — the VS Code
 * explorer arrangement, where each section keeps a height you can drag and
 * folds down to just its header.
 *
 * Sizing is in pixels and ours, not the group's. The group's own collapse/expand
 * remembers a *percentage*, and since these sections do not fill the sidebar on
 * their own, every fold handed slack to a neighbour and the percentages drifted:
 * one section grew on each cycle until the last one had nothing left to expand
 * into and stayed shut with its chevron pointing open. Pinning each section to a
 * pixel height and letting the trailing slack panel — the one panel left
 * relative — absorb the remainder keeps the heights stable across any number of
 * cycles, and keeps chevron and section in agreement because both read the
 * stored preference.
 */
export function SdlcSidebarSection(props: {
  /** Stable across renders — heights and collapse are stored against it. */
  id: string;
  title: string;
  count?: number | undefined;
  /** The `+` beside the header, when the section can be added to. */
  action?: { label: string; onClick: () => void; trackName: string } | undefined;
  children: ReactNode;
}): ReactElement {
  const panel = usePanelRef();
  const collapsedSections = useUserPreference('sdlcSidebarSectionsCollapsed');
  const sectionHeights = useUserPreference('sdlcSidebarSectionHeights');
  const defaultHeight =
    sectionHeights[props.id] ??
    SDLC_SECTIONS.find(section => section.id === props.id)?.defaultHeight ??
    DEFAULT_SECTION_HEIGHT;

  const collapsed = collapsedSections[props.id] ?? false;

  // The preference is the single source of truth: the chevron renders from it and
  // the panel is sized from it, so the two cannot disagree. Every section runs the
  // same layout over the same inputs, so they agree with each other too.
  useEffect(() => {
    const apply = (): void => {
      const element = document.getElementById(props.id);
      const groupHeight = element?.parentElement?.getBoundingClientRect().height ?? 0;
      if (!groupHeight) return;
      const height = sdlcSectionLayout(groupHeight, collapsedSections, sectionHeights)[props.id];
      if (height !== undefined) panel.current?.resize(`${height}px`);
    };
    // Twice: once now, once after the group has taken this render's minSize. A
    // section folding to its header is asking for a height below the floor it
    // had a moment ago, and the first call alone gets clamped short of it.
    apply();
    const frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [panel, props.id, collapsed, collapsedSections, sectionHeights]);

  const toggle = (): void =>
    setUserPreference('sdlcSidebarSectionsCollapsed', {
      ...collapsedSections,
      [props.id]: !collapsed,
    });

  return (
    <Panel
      id={props.id}
      panelRef={panel}
      // Pixels, not percentages — see the note above. The trailing slack panel is
      // the group's one relative panel and gives up the space these take.
      groupResizeBehavior='preserve-pixel-size'
      // Folded, a section is its header. Open, a drag stops here — the group
      // enforces this live, so the section never travels below the floor and
      // springs back, it simply will not go.
      minSize={`${collapsed ? SECTION_HEADER_HEIGHT : MIN_OPEN_SECTION_HEIGHT}px`}
      defaultSize={`${collapsed ? SECTION_HEADER_HEIGHT : defaultHeight}px`}
      className='flex min-h-0 flex-col'
    >
      <div
        className='flex shrink-0 items-center gap-1 px-2'
        style={{ height: SECTION_HEADER_HEIGHT }}
      >
        <button
          type='button'
          onClick={toggle}
          aria-expanded={!collapsed}
          className='flex min-w-0 flex-1 items-center gap-1 rounded-[5px] py-1 pr-1 text-left text-[10.5px] font-bold uppercase tracking-[0.13em] text-foreground/45 transition-colors hover:text-foreground/70'
          data-track-category='SdlcHub'
          data-track-name='SidebarSectionToggled'
          data-track-metadata={JSON.stringify({ section: props.id })}
        >
          <ChevronDown
            className={cn('size-3 shrink-0 transition-transform', collapsed && '-rotate-90')}
          />
          <span className='truncate'>{props.title}</span>
          {props.count !== undefined && (
            <span className='ml-1 shrink-0 text-[10.5px] tabular-nums text-foreground/35'>
              {props.count}
            </span>
          )}
        </button>
        {props.action && (
          <button
            type='button'
            title={props.action.label}
            aria-label={props.action.label}
            onClick={props.action.onClick}
            className='-mr-[7px] flex size-[22px] shrink-0 items-center justify-center rounded-[5px] text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground'
            data-track-category='SdlcHub'
            data-track-name={props.action.trackName}
          >
            <Plus className='size-3.5' />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className='min-h-0 flex-1 overflow-y-auto px-2 pb-2'>{props.children}</div>
      )}
    </Panel>
  );
}

/**
 * Record the heights a drag just produced, for the group these sections live in.
 *
 * Only a real separator drag counts. Every other layout pass — mount, a window
 * resize, our own `resize()` calls — reports sizes too, and taking those at face
 * value is what previously let the first section record the whole sidebar as its
 * chosen height and squash everything below it.
 */
export function persistSdlcSectionHeights(meta: { isUserInteraction: boolean }): void {
  if (!meta.isUserInteraction) return;
  const preferences = userPreferencesSnapshot();
  const stored = { ...preferences.sdlcSidebarSectionHeights };
  const collapsed = preferences.sdlcSidebarSectionsCollapsed;
  let changed = false;
  for (const { id } of SDLC_SECTIONS) {
    const element = document.getElementById(id);
    if (!element) continue;
    // A folded section's height is its header, not a height to return to.
    if (collapsed[id]) continue;
    const measured = Math.round(element.getBoundingClientRect().height);
    const height = Math.max(MIN_OPEN_SECTION_HEIGHT, measured);
    const previous = preferences.sdlcSidebarSectionHeights[id];
    stored[id] = height;
    // A drag below the floor republishes even when it lands on a height already
    // stored: the republish is what re-runs the layout and springs the section
    // back, and skipping it as a no-op left every drag after the first squashed
    // where the pointer dropped it.
    if (measured < MIN_OPEN_SECTION_HEIGHT || previous !== height) changed = true;
  }
  if (changed) setUserPreference('sdlcSidebarSectionHeights', stored);
}

/**
 * The drag handle between two sections.
 *
 * Taller than the line it draws so there is something to actually grab, and the
 * live line is brightest under the middle and fades to nothing at both ends —
 * the same edge treatment the canvas resize handles use, which reads as a grip
 * rather than a border drawn across the sidebar.
 */
export function SdlcSidebarSectionSeparator(): ReactElement {
  return (
    <Separator
      className='group relative shrink-0 cursor-row-resize'
      style={{ height: SECTION_SEPARATOR_HEIGHT }}
    >
      <div
        className='pointer-events-none absolute inset-x-0 top-[3px] h-px bg-sidebar-border-muted'
        aria-hidden='true'
      />
      <div
        className='pointer-events-none absolute inset-x-2 top-[2px] h-[3px] rounded-full bg-gradient-to-r from-transparent via-primary to-transparent opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-active:opacity-100'
        aria-hidden='true'
      />
    </Separator>
  );
}
