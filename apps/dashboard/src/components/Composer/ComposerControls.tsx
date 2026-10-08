import {
  Fragment,
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AtSign,
  AudioLines,
  Bot,
  BookOpen,
  Check,
  ChevronRight,
  ChevronUp,
  FileText,
  FolderGit2,
  Globe,
  Laptop,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  SquareSlash,
  Target,
  X,
  Zap,
} from 'lucide-react';
import {
  ChatDefault,
  File02Default,
  File02Text,
  FolderDefault,
  Hashtag,
  LockClose,
  PhoneDefault,
  TicketToken,
} from '@xyne/icons';
import Avatar from '../ui/Avatar/Avatar';
import { Popover } from '../ui/Popover';
import { AgentGlyph } from '../AIScreen/AIAgentSelector';
import { DEFAULT_AGENT_SLUG } from '../../hooks/useSelectedAgent';
import { cn } from '../../utils/classNames';
import type {
  SelectedCanvas,
  SelectedRecording,
  SelectedTranscript,
  ContextSelections,
} from '../Chat/XyneAISidebar/components/ContextPickerPanel';
import type {
  ComposerAgentControl,
  ComposerModelControl,
  ComposerPlusControl,
  ComposerTrayItem,
  ContextRef,
  ThinkingLevel,
} from './Composer.types';
import { AUTO_MODEL_DESCRIPTION, fitCount } from './Composer.utils';

// ── Shared chrome ───────────────────────────────────────────────────────────

/** Menus share one surface so the +, model and agent menus read as one family. */
export const MENU_SURFACE =
  'z-[60] rounded-[18px] border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-[0_12px_36px_-12px_rgba(0,0,0,0.22)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=top]:slide-in-from-bottom-1 data-[side=bottom]:slide-in-from-top-1 data-[side=right]:slide-in-from-left-1 data-[side=left]:slide-in-from-right-1';
export const MENU_ROW =
  'flex h-9 w-full cursor-pointer select-none items-center gap-3 rounded-[10px] px-2.5 text-left text-sm text-foreground outline-none transition-colors data-[highlighted]:bg-accent data-[state=open]:bg-accent data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
export const MENU_ICON = 'size-[18px] shrink-0 text-muted-foreground';
export const MENU_SEPARATOR = 'mx-2.5 my-1.5 h-px bg-border/70';

/** ↓ from a menu's search field moves into its rows (the menu itself only
 *  moves between rows once one has focus). */
export function focusFirstMenuItem(from: HTMLElement): void {
  from
    .closest('[role="menu"]')
    ?.querySelector<HTMLElement>('[role^="menuitem"]:not([data-disabled])')
    ?.focus();
}

/** Ghost toolbar button — the +, mic and voice controls. */
export function ToolbarIconButton({
  label,
  onClick,
  active,
  disabled,
  trackName,
  className,
  children,
  ...rest
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  trackName: string;
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors',
        'hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
        active && 'bg-secondary text-foreground',
        className,
      )}
      data-track-category='XyneAI'
      data-track-name={trackName}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Presentational switch — the row owns activation, so this never toggles itself. */
const MenuSwitch = ({ checked }: { checked: boolean }): ReactElement => (
  <span
    aria-hidden
    className={cn(
      'ml-auto inline-flex h-[18px] w-8 shrink-0 items-center rounded-full p-0.5 transition-colors',
      checked ? 'bg-foreground/80' : 'bg-muted',
    )}
  >
    <span
      className={cn(
        'size-3.5 rounded-full bg-background shadow-sm transition-transform',
        checked && 'translate-x-3.5',
      )}
    />
  </span>
);

// ── Context tray ────────────────────────────────────────────────────────────

const PILL_GAP = 4;

function TrayPill({ item }: { item: ComposerTrayItem }): ReactElement {
  const label = (
    <span
      className={cn(
        // block: a label inside the pill's button would ignore max-width inline.
        'block max-w-[220px] truncate text-sm leading-5',
        item.tone === 'accent' ? 'text-claw-ai-fg' : 'text-muted-foreground',
        item.onClick && 'group-hover/pill:text-foreground',
      )}
    >
      {item.label}
    </span>
  );
  return (
    <div
      className='group/pill flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-1.5 transition-colors hover:bg-background/70'
      title={item.title ?? item.label}
      data-testid='composer-tray-pill'
    >
      {/* The icon becomes the remove button on hover, so removing never shifts
          the row and the target sits where the eye already is. */}
      <span className='relative grid size-4 shrink-0 place-items-center text-muted-foreground'>
        <span
          className={cn(
            'grid place-items-center transition-opacity',
            item.onRemove && 'group-hover/pill:opacity-0 group-focus-within/pill:opacity-0',
          )}
        >
          {item.icon}
        </span>
        {item.onRemove && (
          <button
            type='button'
            onClick={item.onRemove}
            aria-label={`Remove ${item.label}`}
            className='absolute inset-0 grid place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/pill:opacity-100'
            data-track-category='XyneAI'
            data-track-name='REMOVE_CONTEXT_PILL'
          >
            <X className='size-3.5' aria-hidden strokeWidth={2} />
          </button>
        )}
      </span>
      {item.onClick ? (
        <button
          type='button'
          onClick={item.onClick}
          className='min-w-0 text-left'
          data-track-category='XyneAI'
          data-track-name='OPEN_CONTEXT_PILL'
        >
          {label}
        </button>
      ) : (
        label
      )}
    </div>
  );
}

/**
 * The tray behind the composer's top edge that holds attached context. One
 * line by default — as many pills as fit, then "+N more"; the chevron opens
 * every line. It slides out from under the composer when the first item
 * lands, so the text box itself never moves.
 */
export function ContextTray({
  items,
  overlay = false,
}: {
  items: ComposerTrayItem[];
  /** Rise into the space above instead of pushing the composer down — for a
   *  composer that keeps its top edge still (a new chat). */
  overlay?: boolean;
}): ReactElement {
  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const measure = measureRef.current;
    if (!track || !measure) return;
    const run = (): void => {
      const children = Array.from(measure.children) as HTMLElement[];
      const moreWidth = children.at(-1)?.getBoundingClientRect().width ?? 0;
      const widths = children.slice(0, -1).map(child => child.getBoundingClientRect().width);
      setVisibleCount(fitCount(widths, track.clientWidth, moreWidth, PILL_GAP));
    };
    run();
    const observer = new ResizeObserver(run);
    observer.observe(track);
    observer.observe(measure);
    return (): void => observer.disconnect();
  }, [items]);

  const shown = expanded ? items.length : Math.min(visibleCount, items.length);
  const hidden = items.length - shown;
  const more = (count: number): ReactElement => (
    <button
      type='button'
      onClick={() => setExpanded(true)}
      className='h-7 shrink-0 rounded-lg px-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground'
      data-track-category='XyneAI'
      data-track-name='EXPAND_CONTEXT_PILLS'
    >
      +{count} more
    </button>
  );

  return (
    <AnimatePresence initial={false}>
      {items.length > 0 && (
        <motion.div
          key='tray'
          initial={{ height: 0, opacity: 0, marginBottom: 0 }}
          animate={{ height: 'auto', opacity: 1, marginBottom: -20 }}
          exit={{ height: 0, opacity: 0, marginBottom: 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
          className={cn(
            'overflow-hidden rounded-t-[20px] bg-muted',
            overlay && 'absolute inset-x-0 bottom-full',
          )}
          data-testid='composer-context-tray'
        >
          <div className='flex items-start gap-1 px-3 pb-[26px] pt-1.5'>
            <div
              ref={trackRef}
              className={cn(
                'relative flex min-w-0 flex-1 items-center gap-1',
                expanded ? 'flex-wrap gap-y-0.5' : 'flex-nowrap overflow-hidden',
              )}
            >
              {/* Off-screen twin at natural width, plus a worst-case "+N more",
                  measured to decide how many pills fit on the line. */}
              <div
                ref={measureRef}
                aria-hidden
                className='pointer-events-none invisible absolute left-0 top-0 flex w-max flex-nowrap items-center gap-1'
              >
                {items.map(item => (
                  <TrayPill key={item.key} item={item} />
                ))}
                {more(items.length)}
              </div>
              {items.slice(0, shown).map(item => (
                <Fragment key={item.key}>
                  <TrayPill item={item} />
                </Fragment>
              ))}
              {hidden > 0 && more(hidden)}
            </div>
            {(hidden > 0 || expanded) && (
              <button
                type='button'
                onClick={() => setExpanded(v => !v)}
                aria-label={expanded ? 'Show less context' : 'Show all context'}
                aria-expanded={expanded}
                className='grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground'
                data-track-category='XyneAI'
                data-track-name={expanded ? 'COLLAPSE_CONTEXT_PILLS' : 'EXPAND_CONTEXT_PILLS'}
              >
                <ChevronUp
                  className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                  aria-hidden
                />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const PILL_ICON = 'size-4';

/**
 * Tray pills for everything in a composer's ContextSelections. Each carries its
 * `ref`, so removing the pill also removes the item's inline mention. Hosts
 * append their own pills (the thread the sidebar opened from, attachments, …).
 */
export function selectionTrayItems(
  s: ContextSelections,
  onRemove: (ref: ContextRef) => void,
  open?: {
    canvas?: (canvas: SelectedCanvas) => void;
    transcript?: (transcript: SelectedTranscript) => void;
    recording?: (recording: SelectedRecording) => void;
  },
): ComposerTrayItem[] {
  const pill = (
    ref: ContextRef,
    label: string,
    icon: ReactNode,
    onClick?: () => void,
  ): ComposerTrayItem => ({
    key: `${ref.kind}-${ref.id}`,
    ref,
    label,
    icon,
    onRemove: () => onRemove(ref),
    ...(onClick ? { onClick } : {}),
  });
  return [
    ...s.channels.map(c =>
      pill(
        { kind: 'channel', id: c.id },
        c.name,
        c.isPrivate ? <LockClose className={PILL_ICON} /> : <Hashtag className={PILL_ICON} />,
      ),
    ),
    ...(s.messages ?? []).map(m =>
      pill({ kind: 'message', id: m.id }, m.title, <ChatDefault className={PILL_ICON} />),
    ),
    ...(s.people ?? []).map(p =>
      pill(
        { kind: 'person', id: p.id },
        p.name,
        <Avatar userId={p.id} size='xs' rounded showActiveStatus={false} className='size-4' />,
      ),
    ),
    ...(s.sharedFiles ?? []).map(f =>
      pill({ kind: 'attachment', id: f.id }, f.name, <File02Default className={PILL_ICON} />),
    ),
    ...s.canvases.map(c =>
      pill(
        { kind: 'canvas', id: c.id },
        c.title,
        <File02Text className={PILL_ICON} />,
        open?.canvas ? (): void => open.canvas?.(c) : undefined,
      ),
    ),
    ...s.tickets.map(t =>
      pill(
        { kind: 'ticket', id: t.id },
        t.xyneId ?? t.title,
        <TicketToken className={PILL_ICON} />,
      ),
    ),
    ...s.transcripts.map(t =>
      pill(
        { kind: 'call', id: t.id },
        t.title,
        <PhoneDefault className={PILL_ICON} />,
        open?.transcript && t.channelId ? (): void => open.transcript?.(t) : undefined,
      ),
    ),
    ...s.recordings.map(r =>
      pill(
        { kind: 'call', id: r.id },
        r.title,
        <AudioLines className={PILL_ICON} aria-hidden />,
        open?.recording && (r.externalId || r.channelId)
          ? (): void => open.recording?.(r)
          : undefined,
      ),
    ),
    ...s.localFolders.map(f => ({
      key: `local-${f.path}`,
      label: f.branch ? `${f.name} · ${f.branch}` : f.name,
      title: f.path,
      icon: <FolderGit2 className={PILL_ICON} aria-hidden />,
    })),
  ];
}

/** Knowledge-base scopes as tray pills (collections, folders, single files). */
export function knowledgeTrayItems(
  collections: { id: string; name: string }[],
  folders: { id: string; name: string }[],
  files: { id: string; name: string }[],
  remove: {
    collection: (id: string) => void;
    folder: (id: string) => void;
    file: (id: string) => void;
  },
): ComposerTrayItem[] {
  return [
    ...collections.map(c => ({
      key: `kb-collection-${c.id}`,
      label: c.name,
      icon: <BookOpen className={PILL_ICON} aria-hidden />,
      onRemove: () => remove.collection(c.id),
    })),
    ...folders.map(f => ({
      key: `kb-folder-${f.id}`,
      label: f.name,
      icon: <FolderDefault className={PILL_ICON} />,
      onRemove: () => remove.folder(f.id),
    })),
    ...files.map(f => ({
      key: `kb-file-${f.id}`,
      label: f.name,
      icon: <FileText className={PILL_ICON} aria-hidden />,
      onRemove: () => remove.file(f.id),
    })),
  ];
}

// ── + menu ──────────────────────────────────────────────────────────────────

/** Which of the "+" menu's submenus is open — only ever one. */
const PlusSubmenuContext = createContext<{
  setOpen: (update: (open: string | null) => string | null) => void;
  open: string | null;
} | null>(null);

/**
 * Props for a "+" menu submenu's `Menu.Sub`: opening it closes whichever
 * other submenu was open (Collections → Agents swaps rather than stacking).
 */
export function usePlusSubmenu(
  key: string,
): { open: boolean; onOpenChange: (open: boolean) => void } | Record<string, never> {
  const context = useContext(PlusSubmenuContext);
  if (!context) return {};
  return {
    open: context.open === key,
    onOpenChange: next => context.setOpen(open => (next ? key : open === key ? null : open)),
  };
}

/**
 * The composer's "+" menu. Search modes first (they stay open on toggle so the
 * switch can be seen moving), then what the message is about, then who
 * answers it, then the keyboard affordances — "Slash commands" and "Add
 * context" type "/" and "@" into the message, exactly as pressing the key would.
 */
export function PlusMenu({
  plus,
  collections,
  agents,
  onTrigger,
  returnFocus,
  side = 'top',
  disabled,
}: {
  plus: ComposerPlusControl;
  /** The "Collections ›" row and its submenu. */
  collections: ReactNode;
  /** The "Agents ›" row and its submenu, where the composer has a choice. */
  agents?: ReactNode;
  onTrigger: (char: '@' | '/') => void;
  /** Back to the text once the menu closes, so typing carries on. */
  returnFocus: () => void;
  /** Which way the menu opens from its button. */
  side?: 'top' | 'bottom';
  disabled?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const submenus = useMemo(
    () => ({
      open: openSubmenu,
      setOpen: (update: (open: string | null) => string | null): void => setOpenSubmenu(update),
    }),
    [openSubmenu],
  );
  // Rows that hand off to something outside the menu (the editor, another
  // popover) run after the menu has closed and given up focus — otherwise the
  // menu's focus restore to "+" would steal it straight back.
  const handoff = useRef<(() => void) | null>(null);
  const later = (action: () => void) => (): void => {
    handoff.current = action;
  };

  return (
    <Menu.Root
      open={open}
      onOpenChange={next => {
        if (next) handoff.current = null;
        else setOpenSubmenu(null);
        setOpen(next);
      }}
    >
      <Menu.Trigger asChild disabled={disabled}>
        <button
          type='button'
          aria-label='Add to message'
          title='Add to message'
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
            'data-[state=open]:bg-secondary data-[state=open]:text-foreground',
          )}
          data-track-category='XyneAI'
          data-track-name='OPEN_PLUS_MENU'
        >
          <Plus className='size-[18px]' aria-hidden strokeWidth={1.75} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          side={side}
          align='start'
          sideOffset={8}
          collisionPadding={12}
          className={cn(MENU_SURFACE, 'w-[256px]')}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const action = handoff.current ?? returnFocus;
            handoff.current = null;
            requestAnimationFrame(action);
          }}
        >
          <PlusSubmenuContext.Provider value={submenus}>
            {plus.onWebSearchToggle && (
              <Menu.Item
                className={MENU_ROW}
                disabled={!plus.webSearchAccessible}
                onSelect={e => {
                  e.preventDefault();
                  plus.onWebSearchToggle?.();
                }}
                aria-label={plus.webSearchEnabled ? 'Turn off web search' : 'Turn on web search'}
                data-track-category='XyneAI'
                data-track-name='TOGGLE_WEB_SEARCH'
                data-track-metadata={JSON.stringify({ enabled: plus.webSearchEnabled })}
              >
                <Globe className={MENU_ICON} aria-hidden strokeWidth={1.75} />
                Web search
                <MenuSwitch checked={plus.webSearchEnabled} />
              </Menu.Item>
            )}
            {plus.onDeepResearchToggle && (
              <Menu.Item
                className={MENU_ROW}
                disabled={!plus.deepResearchAccessible}
                onSelect={e => {
                  e.preventDefault();
                  plus.onDeepResearchToggle?.();
                }}
                aria-label={
                  plus.deepResearchEnabled ? 'Turn off deep search' : 'Turn on deep search'
                }
                data-track-category='XyneAI'
                data-track-name='TOGGLE_DEEP_RESEARCH'
                data-track-metadata={JSON.stringify({ enabled: plus.deepResearchEnabled })}
              >
                <Target className={MENU_ICON} aria-hidden strokeWidth={1.75} />
                Deep search
                <MenuSwitch checked={plus.deepResearchEnabled} />
              </Menu.Item>
            )}
            <Menu.Separator className={MENU_SEPARATOR} />
            {collections}
            {plus.onCreateCanvasToggle && (
              <Menu.Item
                className={MENU_ROW}
                onSelect={plus.onCreateCanvasToggle}
                data-track-category='XyneAI'
                data-track-name='TOGGLE_CREATE_CANVAS'
                data-track-metadata={JSON.stringify({ enabled: plus.createCanvasEnabled })}
              >
                <FileText className={MENU_ICON} aria-hidden strokeWidth={1.75} />
                Create canvas
                {plus.createCanvasEnabled && (
                  <Check className='ml-auto size-4 text-foreground' aria-hidden />
                )}
              </Menu.Item>
            )}
            {agents && (
              <>
                <Menu.Separator className={MENU_SEPARATOR} />
                {agents}
              </>
            )}
            <Menu.Separator className={MENU_SEPARATOR} />
            <Menu.Item
              className={MENU_ROW}
              onSelect={later(plus.onAttachFiles)}
              data-track-category='XyneAI'
              data-track-name='ATTACH_FILES'
            >
              <Paperclip className={MENU_ICON} aria-hidden strokeWidth={1.75} />
              Attach files
            </Menu.Item>
            <Menu.Item
              className={MENU_ROW}
              onSelect={later(() => onTrigger('/'))}
              data-track-category='XyneAI'
              data-track-name='OPEN_SLASH_COMMANDS'
            >
              <SquareSlash className={MENU_ICON} aria-hidden strokeWidth={1.75} />
              Slash commands
            </Menu.Item>
            <Menu.Item
              className={MENU_ROW}
              onSelect={later(() => onTrigger('@'))}
              data-track-category='XyneAI'
              data-track-name='OPEN_CONTEXT_PICKER'
            >
              <AtSign className={MENU_ICON} aria-hidden strokeWidth={1.75} />
              Add context
            </Menu.Item>
            {plus.extra && (
              <>
                <Menu.Separator className={MENU_SEPARATOR} />
                {plus.extra}
              </>
            )}
          </PlusSubmenuContext.Provider>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * A "+" menu row that opens a short list of choices beside the menu — for a
 * host's own setting (the desktop app's sandbox).
 */
export function PlusMenuChoice<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
  disabled,
  trackName,
}: {
  icon: ReactNode;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; description?: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  trackName: string;
}): ReactElement {
  const current = options.find(o => o.value === value);
  const submenu = usePlusSubmenu(`choice:${label}`);
  return (
    <Menu.Sub {...submenu}>
      <Menu.SubTrigger
        className={MENU_ROW}
        disabled={disabled ?? false}
        data-track-category='XyneAI'
        data-track-name={trackName}
      >
        {icon}
        {label}
        <span className='ml-auto truncate text-muted-foreground'>{current?.label}</span>
        <ChevronRight className='size-4 shrink-0 text-muted-foreground' aria-hidden />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent
          sideOffset={10}
          alignOffset={-6}
          collisionPadding={12}
          className={cn(MENU_SURFACE, 'w-[280px]')}
        >
          {options.map(option => (
            <Menu.Item
              key={option.value}
              onSelect={() => onChange(option.value)}
              className={cn(MENU_ROW, 'h-auto items-start py-2')}
              data-track-category='XyneAI'
              data-track-name={`${trackName}_SELECT`}
              data-track-metadata={JSON.stringify({ value: option.value })}
            >
              <span className='flex min-w-0 flex-1 flex-col'>
                <span>{option.label}</span>
                {option.description && (
                  <span className='text-[13px] leading-snug text-muted-foreground'>
                    {option.description}
                  </span>
                )}
              </span>
              {option.value === value && <Check className='mt-1 size-4 shrink-0' aria-hidden />}
            </Menu.Item>
          ))}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}

// ── Modes ───────────────────────────────────────────────────────────────────

/**
 * What the "+" menu turned on for this chat — web search, deep search,
 * canvas — shown beside the agent so it is never a hidden state. Hovering a
 * chip turns its icon into ×; clicking turns the mode off. A narrow composer
 * (the sidebar) keeps the icon and drops the label.
 */
export function ModeChips({
  plus,
  compact,
}: {
  plus: ComposerPlusControl;
  compact: boolean;
}): ReactElement {
  const modes = [
    plus.webSearchEnabled && plus.onWebSearchToggle
      ? {
          key: 'web',
          Icon: Globe,
          label: 'Web search',
          off: plus.onWebSearchToggle,
          trackName: 'TOGGLE_WEB_SEARCH',
        }
      : null,
    plus.deepResearchEnabled && plus.onDeepResearchToggle
      ? {
          key: 'deep',
          Icon: Target,
          label: 'Deep search',
          off: plus.onDeepResearchToggle,
          trackName: 'TOGGLE_DEEP_RESEARCH',
        }
      : null,
    plus.createCanvasEnabled && plus.onCreateCanvasToggle
      ? {
          key: 'canvas',
          Icon: FileText,
          label: 'Canvas',
          off: plus.onCreateCanvasToggle,
          trackName: 'TOGGLE_CREATE_CANVAS',
        }
      : null,
  ].filter(mode => mode !== null);

  return (
    <AnimatePresence initial={false}>
      {modes.map(mode => (
        <motion.button
          key={mode.key}
          type='button'
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
          onClick={mode.off}
          aria-label={`${mode.label} is on. Turn off`}
          title={`${mode.label} is on — click to turn off`}
          className={cn(
            'group/mode inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[var(--mention-bg)] text-sm text-[color:var(--mention-color)]',
            compact ? 'w-8 justify-center' : 'pl-2 pr-2.5',
          )}
          data-track-category='XyneAI'
          data-track-name={mode.trackName}
          data-track-metadata={JSON.stringify({ enabled: true, source: 'chip' })}
          data-testid={`composer-mode-${mode.key}`}
        >
          <span className='relative grid size-4 place-items-center'>
            {/* A member expression, so no PascalCase binding trips the naming rule. */}
            <mode.Icon
              className='size-4 transition-opacity group-hover/mode:opacity-0'
              aria-hidden
              strokeWidth={1.75}
            />
            <X
              className='absolute size-3.5 opacity-0 transition-opacity group-hover/mode:opacity-100'
              aria-hidden
              strokeWidth={2}
            />
          </span>
          {!compact && mode.label}
        </motion.button>
      ))}
    </AnimatePresence>
  );
}

// ── Model menu ──────────────────────────────────────────────────────────────

/** Slider stops, left to right. Auto (null) is the agent's own setting. */
const THINKING_STOPS: Array<{ value: ThinkingLevel | null; label: string }> = [
  { value: null, label: 'Auto' },
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
/** The thumb's diameter, which is also the track's thickness (px). */
const THUMB = 16;
/** Where stop `f` (0–1) sits: the thumb stays inside the track at both ends. */
const stopAt = (f: number): string => `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${f})`;

/**
 * How hard the model thinks, as a slider in the model menu. Click or drag the
 * track, or ←/→ while the row is highlighted; the fill and thumb glide between
 * stops. It is a menu row, so ↑/↓ reach it like any other.
 */
function ThinkingSlider({
  value,
  onChange,
}: {
  value: ThinkingLevel | null;
  onChange: (value: ThinkingLevel | null) => void;
}): ReactElement {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const index = Math.max(
    0,
    THINKING_STOPS.findIndex(stop => stop.value === value),
  );
  const last = THINKING_STOPS.length - 1;
  const fraction = index / last;
  const isAuto = index === 0;

  const setIndex = (next: number): void => {
    const clamped = Math.min(last, Math.max(0, next));
    if (clamped !== index) onChange(THINKING_STOPS[clamped]!.value);
  };
  const fromPointer = (clientX: number): void => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= THUMB) return;
    setIndex(Math.round(((clientX - rect.left - THUMB / 2) / (rect.width - THUMB)) * last));
  };

  return (
    <Menu.Item
      role='slider'
      aria-label='Thinking'
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={index}
      aria-valuetext={THINKING_STOPS[index]!.label}
      // Picking a level keeps the menu open, like the search switches.
      onSelect={e => e.preventDefault()}
      onKeyDown={e => {
        const step: Partial<Record<string, number>> = {
          ArrowLeft: index - 1,
          ArrowRight: index + 1,
          Home: 0,
          End: last,
        };
        const next = step[e.key];
        if (next === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        setIndex(next);
      }}
      // No row highlight: the thumb shows focus instead.
      className={cn(
        MENU_ROW,
        'group/thinking h-auto cursor-default flex-col items-stretch gap-0 pb-3 pt-2 data-[highlighted]:bg-transparent',
      )}
      data-track-category='XyneAI'
      data-track-name='SELECT_THINKING_LEVEL'
      data-track-metadata={JSON.stringify({ level: THINKING_STOPS[index]!.label })}
    >
      <span className='flex items-center'>
        Thinking
        <span className='ml-auto text-muted-foreground'>{THINKING_STOPS[index]!.label}</span>
      </span>
      <span
        ref={trackRef}
        role='presentation'
        className='relative mt-2.5 block h-4 cursor-pointer touch-none rounded-full bg-muted'
        onPointerDown={e => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e.clientX);
        }}
        onPointerMove={e => {
          if (dragging.current) fromPointer(e.clientX);
        }}
        onPointerUp={e => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none',
            isAuto && 'opacity-0',
          )}
          style={{ width: `calc(${THUMB}px + (100% - ${THUMB}px) * ${fraction})` }}
        />
        {THINKING_STOPS.map((stop, i) => (
          <span
            key={stop.label}
            aria-hidden
            className={cn(
              'absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200',
              i < index && !isAuto ? 'bg-background/70' : 'bg-muted-foreground/30',
            )}
            style={{ left: stopAt(i / last) }}
          />
        ))}
        <span
          aria-hidden
          className={cn(
            'absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background shadow-sm transition-[left,border-color,box-shadow] duration-200 ease-out motion-reduce:transition-none',
            'group-data-[highlighted]/thinking:ring-4 group-data-[highlighted]/thinking:ring-foreground/10',
            isAuto ? 'border-muted-foreground/40' : 'border-foreground',
          )}
          style={{ left: stopAt(fraction) }}
        />
      </span>
    </Menu.Item>
  );
}

/**
 * Model picker: the pill names what runs ("Auto" = the agent's own model), the
 * menu says what that choice is good for, and the Model / Thinking rows open
 * their lists beside it.
 */
export function ModelMenu({
  model,
  returnFocus,
  side = 'top',
}: {
  model: ComposerModelControl;
  /** Back to the text once the menu closes, so typing carries on. */
  returnFocus: () => void;
  /** Which way the menu opens from its button. */
  side?: 'top' | 'bottom';
}): ReactElement {
  const [query, setQuery] = useState('');
  const selected = useMemo(
    () => model.models.find(m => m.id === model.selectedModel) ?? null,
    [model.models, model.selectedModel],
  );
  // Names and descriptions come from claw-auth's model catalog.
  const pillLabel = selected ? selected.name : 'Auto';
  const summary = selected
    ? (selected.description ?? `Every message in this chat runs on ${pillLabel}`)
    : AUTO_MODEL_DESCRIPTION;
  const defaultName = model.defaultModelName ?? model.defaultModel;
  const q = query.trim().toLowerCase();
  const filtered = model.models.filter(
    m => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
  );

  const choice = (
    key: string,
    name: string,
    description: string | undefined,
    active: boolean,
    onSelect: () => void,
    icon?: ReactNode,
  ): ReactElement => (
    <Menu.Item
      key={key}
      onSelect={onSelect}
      className={cn(MENU_ROW, 'h-auto items-start py-2')}
      data-track-category='XyneAI'
      data-track-name='SELECT_MODEL'
      data-track-metadata={JSON.stringify({ model: key })}
    >
      {icon}
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate'>{name}</span>
        {description && (
          <span className='truncate text-[13px] text-muted-foreground'>{description}</span>
        )}
      </span>
      {active && <Check className='mt-1 size-4 shrink-0' aria-hidden />}
    </Menu.Item>
  );

  return (
    <Menu.Root onOpenChange={open => !open && setQuery('')}>
      <Menu.Trigger asChild disabled={model.disabled}>
        <button
          type='button'
          title={selected ? selected.id : (model.defaultModel ?? 'Auto')}
          className='inline-flex h-8 min-w-0 shrink items-center rounded-full px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:bg-secondary data-[state=open]:text-foreground'
          data-track-category='XyneAI'
          data-track-name='OPEN_MODEL_SELECTOR'
          data-testid='composer-model'
        >
          <span className='truncate'>{pillLabel}</span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          side={side}
          align='start'
          sideOffset={8}
          collisionPadding={12}
          className={cn(MENU_SURFACE, 'w-[232px]')}
          onCloseAutoFocus={event => {
            event.preventDefault();
            returnFocus();
          }}
        >
          <div className='px-2.5 pb-2.5 pt-2 text-sm leading-snug text-foreground'>{summary}</div>
          <Menu.Separator className={MENU_SEPARATOR} />
          <Menu.Sub>
            <Menu.SubTrigger
              className={MENU_ROW}
              data-track-category='XyneAI'
              data-track-name='OPEN_MODEL_LIST'
            >
              Model
              <span className='ml-auto max-w-[110px] truncate text-muted-foreground'>
                {pillLabel}
              </span>
              <ChevronRight className='size-4 shrink-0 text-muted-foreground' aria-hidden />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent
                sideOffset={10}
                alignOffset={-6}
                collisionPadding={12}
                className={cn(MENU_SURFACE, 'flex w-[260px] flex-col')}
              >
                {model.models.length > 6 && (
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    // Typing filters; the menu's own typeahead would jump rows instead.
                    onKeyDown={e => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        focusFirstMenuItem(e.currentTarget);
                      } else if (e.key !== 'Escape') {
                        e.stopPropagation();
                      }
                    }}
                    placeholder='Search...'
                    className='mb-1 h-9 w-full bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground'
                    data-track-category='XyneAI'
                    data-track-name='SEARCH_MODELS'
                  />
                )}
                <div className='max-h-[min(340px,55vh)] overflow-y-auto'>
                  {model.loading && (
                    <div className='flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground'>
                      <Loader2 className='size-4 animate-spin' aria-hidden />
                      Loading models…
                    </div>
                  )}
                  {!q &&
                    choice(
                      'auto',
                      'Auto',
                      defaultName ? `Uses ${defaultName} by default` : AUTO_MODEL_DESCRIPTION,
                      model.selectedModel === null,
                      () => model.onSelectModel(null),
                    )}
                  {!model.loading &&
                    filtered.map(m =>
                      choice(
                        m.id,
                        m.name,
                        m.description,
                        model.selectedModel === m.id,
                        () => model.onSelectModel(m.id),
                        m.provider === 'local-harness' ? (
                          <Laptop className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                        ) : undefined,
                      ),
                    )}
                  {!model.loading && q && filtered.length === 0 && (
                    <div className='px-2.5 py-2 text-sm text-muted-foreground'>No models match</div>
                  )}
                </div>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <ThinkingSlider value={model.thinkingLevel} onChange={model.onSelectThinking} />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

// ── Agents ──────────────────────────────────────────────────────────────────

const AGENT_ROW =
  'flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-sm text-foreground aria-selected:bg-accent';

interface AgentOption {
  /** Agent slug, or 'auto' / 'ask-ai'. */
  value: string;
  label: string;
  icon: (size: number) => ReactNode;
  instant: boolean;
  run: () => void;
}

/** The glyph for Auto / Ask AI, which have no avatar of their own. */
function botGlyph(tone: string): (size: number) => ReactNode {
  return function BotGlyph(size: number): ReactNode {
    return (
      <span
        className={cn('grid shrink-0 place-items-center rounded-full', tone)}
        style={{ width: size, height: size }}
      >
        <Bot style={{ width: size * 0.62, height: size * 0.62 }} aria-hidden />
      </span>
    );
  };
}

/**
 * Every choice the composer offers, the default agent first, then Auto (routes
 * each message), Ask AI and the rest — and which one is current and which is
 * the default. The default is the xyne agent when it is listed, else Auto
 * where it can route, else Ask AI.
 */
function useAgentOptions(agent: ComposerAgentControl): {
  options: AgentOption[];
  current: AgentOption;
  fallback: AgentOption;
} {
  return useMemo(() => {
    const agentOption = (a: ComposerAgentControl['agents'][number]): AgentOption => ({
      value: a.slug,
      label: a.name,
      icon: size => (
        <AgentGlyph color={a.color} name={a.name} userId={a.botUserId} size={size} rounded />
      ),
      instant: a.instantAgent === true,
      run: () => agent.onSelect(a.slug),
    });
    const listed = agent.agents.filter(a => a.slug !== 'ask-ai');
    const xyne = listed.find(a => a.slug === DEFAULT_AGENT_SLUG);
    const auto: AgentOption = {
      value: 'auto',
      label: 'Auto',
      icon: botGlyph('bg-primary/10 text-primary'),
      instant: false,
      run: agent.onSelectAuto,
    };
    const askAi: AgentOption = {
      value: 'ask-ai',
      label: 'Ask AI',
      icon: botGlyph('bg-secondary text-muted-foreground'),
      instant: false,
      run: () => agent.onSelect(null),
    };
    const options = [
      ...(xyne ? [agentOption(xyne)] : []),
      ...(agent.canAuto ? [auto] : []),
      askAi,
      ...listed.filter(a => a.slug !== DEFAULT_AGENT_SLUG).map(agentOption),
    ];
    const currentValue =
      agent.canAuto && agent.isAuto && agent.selectedSlug === null
        ? 'auto'
        : (agent.selectedSlug ?? 'ask-ai');
    const fallback = options[0] ?? askAi;
    const current = options.find(o => o.value === currentValue) ??
      // A selected agent that isn't listed (yet) still names itself.
      { ...askAi, value: currentValue, label: currentValue };
    return { options, current, fallback };
  }, [agent]);
}

/**
 * "Agents ›" in the "+" menu: who answers. Opens beside the menu like Model ›;
 * the row names the current choice.
 */
export function AgentsSubmenu({ agent }: { agent: ComposerAgentControl }): ReactElement {
  const { options, current } = useAgentOptions(agent);
  const submenu = usePlusSubmenu('agents');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = options.filter(o => !q || o.label.toLowerCase().includes(q));

  return (
    <Menu.Sub
      {...submenu}
      onOpenChange={open => {
        if (!open) setQuery('');
        submenu.onOpenChange?.(open);
      }}
    >
      <Menu.SubTrigger
        className={MENU_ROW}
        disabled={agent.disabled ?? false}
        data-track-category='XyneAI'
        data-track-name='OPEN_AGENT_SELECTOR'
      >
        <Sparkles className={MENU_ICON} aria-hidden strokeWidth={1.75} />
        Agents
        <span className='ml-auto max-w-[110px] truncate text-muted-foreground'>
          {current.label}
        </span>
        <ChevronRight className='size-4 shrink-0 text-muted-foreground' aria-hidden />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent
          sideOffset={10}
          alignOffset={-6}
          collisionPadding={12}
          className={cn(MENU_SURFACE, 'flex w-[260px] flex-col')}
        >
          {options.length > 6 && (
            <div className='flex items-center px-2.5'>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    focusFirstMenuItem(e.currentTarget);
                  } else if (e.key !== 'Escape') {
                    e.stopPropagation();
                  }
                }}
                placeholder='Search agents'
                className='h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
                data-track-category='XyneAI'
                data-track-name='SearchAgentSelector'
              />
            </div>
          )}
          <div className='max-h-[min(340px,55vh)] overflow-y-auto'>
            {filtered.map(option => (
              <Menu.Item
                key={option.value}
                onSelect={option.run}
                className={MENU_ROW}
                data-track-category='XyneAI'
                data-track-name='SELECT_AGENT'
                data-track-metadata={JSON.stringify({ agentSlug: option.value })}
              >
                {option.icon(20)}
                <span className='min-w-0 flex-1 truncate'>{option.label}</span>
                {option.instant && (
                  <Zap
                    className='size-3.5 shrink-0 text-status-pending'
                    aria-label='Instant agent'
                  />
                )}
                {option.value === current.value && (
                  <Check className='size-4 shrink-0' aria-hidden />
                )}
              </Menu.Item>
            ))}
            {filtered.length === 0 && (
              <div className='px-2.5 py-2 text-sm text-muted-foreground'>No agents match</div>
            )}
          </div>
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}

/**
 * The agent in the toolbar — shown only when the user picked one other than
 * the default, so the usual case stays quiet. Its avatar turns into × on
 * hover, which goes back to the default; the name opens the list to switch.
 */
export function AgentPicker({
  agent,
  returnFocus,
  side = 'top',
}: {
  agent: ComposerAgentControl;
  /** Back to the text once the list closes, so typing carries on. */
  returnFocus: () => void;
  /** Which way the list opens from the pill. */
  side?: 'top' | 'bottom';
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const { options, current, fallback } = useAgentOptions(agent);
  if (current.value === fallback.value) return null;

  const row = (option: AgentOption): ReactElement => (
    <Command.Item
      key={option.value}
      value={option.value}
      keywords={[option.label]}
      onSelect={() => {
        option.run();
        setOpen(false);
      }}
      className={AGENT_ROW}
      data-track-category='XyneAI'
      data-track-name='SELECT_AGENT'
      data-track-metadata={JSON.stringify({ agentSlug: option.value })}
    >
      {option.icon(22)}
      <span className='min-w-0 flex-1 truncate'>{option.label}</span>
      {option.value === current.value && <Check className='size-4 shrink-0' aria-hidden />}
    </Command.Item>
  );

  return (
    <div
      className={cn(
        'group/agent inline-flex h-8 min-w-0 max-w-[200px] shrink items-center rounded-full pl-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
        open && 'bg-secondary text-foreground',
        agent.disabled && 'pointer-events-none opacity-60',
      )}
      data-testid='composer-agent'
    >
      <button
        type='button'
        onClick={() => {
          fallback.run();
          returnFocus();
        }}
        disabled={agent.disabled}
        aria-label={`Back to ${fallback.label}`}
        title={`Back to ${fallback.label}`}
        className='relative grid size-[18px] shrink-0 place-items-center rounded-full'
        data-track-category='XyneAI'
        data-track-name='RESET_AGENT'
        data-track-metadata={JSON.stringify({ from: current.value, to: fallback.value })}
      >
        <span className='grid place-items-center transition-opacity group-hover/agent:opacity-0'>
          {current.icon(18)}
        </span>
        <X
          className='absolute size-3.5 opacity-0 transition-opacity group-hover/agent:opacity-100'
          aria-hidden
          strokeWidth={2}
        />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side={side}
        align='start'
        sideOffset={8}
        collisionPadding={12}
        className={cn(MENU_SURFACE, 'w-[280px] p-0')}
        onCloseAutoFocus={event => {
          event.preventDefault();
          returnFocus();
        }}
        trigger={
          <button
            type='button'
            disabled={agent.disabled}
            className='flex h-8 min-w-0 items-center gap-1.5 pl-2 pr-2.5'
            data-track-category='XyneAI'
            data-track-name='OPEN_AGENT_SELECTOR'
          >
            <span className='truncate'>{current.label}</span>
            {current.instant && (
              <Zap className='size-3.5 shrink-0 text-status-pending' aria-label='Instant agent' />
            )}
          </button>
        }
      >
        <Command loop className='flex max-h-[min(380px,60vh)] flex-col'>
          <div className='flex items-center px-3.5'>
            <Command.Input
              autoFocus
              placeholder='Search agents'
              className='h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
              data-track-category='XyneAI'
              data-track-name='SearchAgentSelector'
            />
          </div>
          <Command.List className='overflow-y-auto p-1.5'>
            <Command.Empty className='px-3 py-4 text-center text-sm text-muted-foreground'>
              No agents match
            </Command.Empty>
            {options.map(row)}
          </Command.List>
        </Command>
      </Popover>
    </div>
  );
}
