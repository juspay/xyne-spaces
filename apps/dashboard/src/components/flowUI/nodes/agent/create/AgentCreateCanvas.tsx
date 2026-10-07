import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AtMark, PencilEditLine, Settings02 } from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, type MotionProps } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/utils/classNames';
import { AutoWidthInput } from '@/routes/AIScreen/library/shared/primitives/AutoWidthInput';
import { BuiltinCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/builtin/BuiltinCapabilityRow';
import { KnowledgeCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/knowledge/KnowledgeCapabilityRow';
import { McpCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/mcp/McpCapabilityRow';
import { CapabilityPillsReadOnly } from '@/routes/AIScreen/library/shared/pickers/CapabilityPillList';
import { SkillsCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/skill/SkillsCapabilityRow';
import { SubagentCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/subagent/SubagentCapabilityRow';
import { slugify } from '@/routes/ClawAgentsScreen/create/wizardState';
import { DraftAgentAvatar } from './DraftAgentAvatar';
import { AddPropertyMenu, PROPERTY_MENU_ITEM } from './AddPropertyMenu';
import { ChatFillHighlight } from './ChatFillHighlight';
import { InstructionsReveal } from './InstructionsReveal';
import { focusInCanvas } from './canvasFocusIn';
import { CANVAS_COLUMN_ATTR, glideCanvasFrom } from './editTransition';
import { CustomPropertyRow } from './CustomPropertyRow';
import { EditablePropertyLabel } from './EditablePropertyLabel';
import { PropertyRow } from './PropertyRow';
import { ScheduleRow } from './ScheduleRow';
import { defaultSchedule } from './agentSchedule';
import { createCustomProperty, type CustomProperty } from './customProperty';
import {
  CANVAS_LAYOUT_SPRING,
  CanvasEntranceContext,
  ROW_EXIT,
  ROW_FROM,
  ROW_STAGGER_S,
  RowEntrance,
  rowIn,
  useEntranceDelays,
  useLiveAfterMount,
} from './createMotion';
import type {
  AgentCreateConflict,
  AgentCreateField,
  AgentCreateFormState,
  AgentCreateHubRow,
  AgentCreatePhase,
  CreateHubSuggestions,
  HubPickKind,
} from './types';

/** A property row the chat (or Add property) brings in: fades up after `delay`, and its neighbours slide. */
function rowMotion(delay: number): MotionProps {
  return {
    layout: 'position' as const,
    initial: ROW_FROM,
    animate: rowIn(delay),
    exit: ROW_EXIT,
    transition: { layout: CANVAS_LAYOUT_SPRING },
  };
}
const HUB_ROWS: readonly AgentCreateHubRow[] = [
  'mcp',
  'subagent',
  'builtin',
  'skills',
  'knowledge',
];

const SLIDE_ONLY = { layout: 'position' as const, transition: { layout: CANVAS_LAYOUT_SPRING } };

interface AgentCreateCanvasProps {
  form: AgentCreateFormState;
  onFormChange: (patch: Partial<AgentCreateFormState>) => void;
  onFieldFocus: (field: AgentCreateField | null) => void;
  highlights: ReadonlySet<AgentCreateField>;
  conflicts: AgentCreateConflict[];
  onResolveConflict: (field: AgentCreateField, choice: 'mine' | 'chat') => void;
  phase: AgentCreatePhase;
  builtBy?: string | undefined;
  handleError?: string | null | undefined;
  checkingHandle?: boolean | undefined;
  note?: string | null | undefined;
  footer?: ReactNode;
  /** Split-page profile. Classic keeps the Agent preview dialog layout. */
  layout?: 'classic' | 'profile';
  onSave?: () => void;
  onCancel?: () => void;
  canSave?: boolean;
  /** Why Save is disabled, shown as its tooltip. */
  saveBlockedReason?: string | null;
  saving?: boolean;
  saveError?: string | null;
  readOnly?: boolean;
  onClose?: () => void;
  /** First empty-canvas describe only: skeleton identity + instructions, Hub rows stay. */
  skeletonIdentity?: boolean;
  /** Field currently being written by chat. Drives the write shimmer. */
  writingField?: AgentCreateField | null;
  /** Hub row under `writingField` when filling MCP / tools / skills / knowledge. */
  writingHubRow?: AgentCreateHubRow | null;
  /** Upcoming or active section (anticipating shimmer when writingField is empty). */
  attentionField?: AgentCreateField | null;
  attentionHubRow?: AgentCreateHubRow | null;
  /** Mid-confidence picks rendered as dashed one-click chips (profile layout). */
  hubSuggestions?: CreateHubSuggestions | undefined;
  /** A suggested chip was clicked (+): drop it from the suggestions. */
  onHubSuggestionAccepted?: ((kind: HubPickKind, id: string) => void) | undefined;
  /** The user removed a chip: never suggest or auto-add it again this session. */
  onHubPickDismissed?: ((kind: HubPickKind, id: string) => void) | undefined;
  /** Opens the agent's settings: the gear at the right end of the identity row. */
  onOpenSettings?: () => void;
  /** Replaces the "Create Agent" bar (the profile's back link and actions). */
  topBar?: ReactNode;
  /** The bar's title: "Create Agent", or "Edit Agent" for a saved one. */
  title?: string;
  /** Before the gear, at the right of the identity row (the profile's Edit / Save). */
  identityActions?: ReactNode;
  /** After the name (Enabled / Disabled). */
  nameBadge?: ReactNode;
  /** After the handle (version, last updated). */
  handleMeta?: ReactNode;
  /** The avatar, when it isn't the draft's own (a saved agent's). */
  avatar?: ReactNode;
  /** A draft's face: the key it was given when the draft started (see DraftAgentAvatar). */
  avatarKey?: string | undefined;
  /** Above the identity (the "agent created" banner). */
  banner?: ReactNode;
  /** Looking, not editing: nothing dims, and nothing can be added or removed. */
  viewOnly?: boolean;
  /** Only the owner renames an agent's handle. */
  handleLocked?: boolean;
  /** A saved agent's schedules are managed in Settings, Activity: the row only shows it. */
  scheduleLocked?: boolean;
  /** Docked over the bottom of the canvas (the draft agent's test chat). */
  floatingChat?: ReactNode;
  /**
   * The whole canvas arrived at once (a restored draft): it sweeps in top to
   * bottom as one, and rows and pills skip their own entrances because they
   * are there from the first render.
   */
  revealOnMount?: boolean;
  /**
   * Where the canvas column was on the page before (an agent's profile, on its
   * way to editing): the canvas glides from there instead of focusing in.
   */
  glideFromLeft?: number | undefined;
}

function ConflictChooser({
  onKeep,
  onUseChat,
}: {
  onKeep: () => void;
  onUseChat: () => void;
}): ReactElement {
  return (
    <div className='flex flex-wrap items-center gap-2 text-sm leading-5'>
      <span className='text-muted-foreground'>Chat proposed a different value.</span>
      <button
        type='button'
        onClick={onKeep}
        className='font-medium text-foreground underline-offset-2 hover:underline'
        data-track-category='AGENT_ARTIFACT'
        data-track-name='CONFLICT_KEEP_MINE'
        data-testid='conflict-keep-mine'
      >
        Keep mine
      </button>
      <span className='text-muted-foreground' aria-hidden>
        ·
      </span>
      <button
        type='button'
        onClick={onUseChat}
        className='font-medium text-foreground underline-offset-2 hover:underline'
        data-track-category='AGENT_ARTIFACT'
        data-track-name='CONFLICT_USE_CHAT'
        data-testid='conflict-use-chat'
      >
        Use chat
      </button>
    </div>
  );
}

/** Save, with the blocking reason as a tooltip (a disabled button gets no hover, so the span is the trigger). */
function SaveButton({
  onSave,
  disabled,
  saving,
  blockedReason,
}: {
  onSave: () => void;
  disabled: boolean;
  saving: boolean;
  blockedReason: string | null;
}): ReactElement {
  const reasonId = useId();
  const button = (
    <Button
      type='button'
      variant='ink'
      size='sm'
      onClick={onSave}
      disabled={disabled}
      loading={saving}
      aria-describedby={blockedReason ? reasonId : undefined}
      data-track-category='AGENT_ARTIFACT'
      data-track-name='CLICK_APPROVE'
      data-testid='create-agent-save'
      data-save-blocked-reason={blockedReason ?? ''}
    >
      Save
    </Button>
  );
  if (!blockedReason) return button;
  return (
    <Tooltip content={blockedReason} side='bottom'>
      <span className='inline-flex'>
        {button}
        <span id={reasonId} className='sr-only'>
          {blockedReason}
        </span>
      </span>
    </Tooltip>
  );
}

function IdentitySkeleton(): ReactElement {
  return (
    <div
      className='flex flex-col gap-8'
      aria-busy='true'
      aria-label='Drafting identity'
      data-testid='agent-create-identity-skeleton'
    >
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-7 w-48' />
        <Skeleton className='h-8 w-36 rounded-[10px]' />
        <Skeleton className='h-4 w-40' />
      </div>
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-4 w-24' />
        <Skeleton className='h-[86px] w-full rounded-none' />
      </div>
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-4 w-28' />
        <Skeleton className='h-[180px] w-full rounded-none' />
      </div>
    </div>
  );
}

export function AgentCreateCanvas({
  form,
  onFormChange,
  onFieldFocus,
  highlights,
  conflicts,
  onResolveConflict,
  phase,
  builtBy,
  handleError,
  checkingHandle,
  note,
  footer,
  layout = 'classic',
  onSave,
  onCancel,
  canSave = false,
  saveBlockedReason,
  saving = false,
  saveError,
  readOnly,
  onClose,
  skeletonIdentity,
  writingField = null,
  writingHubRow = null,
  attentionField = null,
  attentionHubRow = null,
  hubSuggestions,
  onHubSuggestionAccepted,
  onHubPickDismissed,
  onOpenSettings,
  topBar,
  identityActions,
  nameBadge,
  handleMeta,
  avatar,
  avatarKey,
  banner,
  viewOnly = false,
  handleLocked = false,
  scheduleLocked = false,
  title = 'Create Agent',
  floatingChat,
  revealOnMount = false,
  glideFromLeft,
}: AgentCreateCanvasProps): ReactElement {
  const conflictByField = useMemo(
    () => new Map(conflicts.map(conflict => [conflict.field, conflict])),
    [conflicts],
  );
  const disabled = readOnly || viewOnly || phase === 'created' || phase === 'rejected';
  const suggestContext = {
    systemPrompt: form.systemPrompt,
    description: form.description,
  };

  const renderConflict = (field: AgentCreateField): ReactNode => {
    if (!conflictByField.has(field)) return null;
    return (
      <ConflictChooser
        onKeep={() => onResolveConflict(field, 'mine')}
        onUseChat={() => onResolveConflict(field, 'chat')}
      />
    );
  };

  // A restored draft comes into focus as one piece (canvasFocusIn.ts). Before
  // the first paint, so nothing shows before it starts.
  const columnRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Read once: the canvas arrives one way, on mount.
  const glideFromRef = useRef(glideFromLeft);
  useLayoutEffect(() => {
    const column = columnRef.current;
    const root = rootRef.current;
    if (!column) return undefined;
    // Coming from the profile it is the same canvas, moving over: no blur.
    if (glideFromRef.current !== undefined && root) {
      return glideCanvasFrom(root, column, glideFromRef.current);
    }
    if (!revealOnMount) return undefined;
    return focusInCanvas(column);
  }, [revealOnMount]);
  const showIdentitySkeleton = Boolean(skeletonIdentity);
  const isProfile = layout === 'profile';
  // Rows that land together (a draft turn fills several at once) come in one by
  // one, top to bottom; each hub row's pills follow it (see CapabilityPillList).
  const live = useLiveAfterMount();
  const entranceRoot = useMemo(() => ({ live, rowDelay: null }), [live]);
  const rowDelay = useEntranceDelays(false, ROW_STAGGER_S);
  const arriving = (key: string): MotionProps => rowMotion(rowDelay(key));
  const [addedRows, setAddedRows] = useState<Set<AgentCreateHubRow>>(() => new Set());
  /** Rows the user removed from the property list. They come back when the chat fills them or Add property is used. */
  const [removedRows, setRemovedRows] = useState<Set<AgentCreateHubRow>>(() => new Set());
  const customProperties = form.customProperties;
  const setCustomProperties = (update: (prev: CustomProperty[]) => CustomProperty[]): void =>
    onFormChange({ customProperties: update(form.customProperties) });
  const [propertyLabels, setPropertyLabels] = useState({
    description: 'Description',
    builtin: 'Built in tools',
  });
  const propertyLabel = (key: keyof typeof propertyLabels): ReactElement => (
    <EditablePropertyLabel
      value={propertyLabels[key]}
      disabled={disabled}
      testId={`property-label-${key}`}
      onCommit={next => setPropertyLabels(prev => ({ ...prev, [key]: next }))}
    />
  );

  const rowHasContent = (row: AgentCreateHubRow): boolean => {
    switch (row) {
      // Same buckets the pickers write: MCP → direct/gateway, built-in → custom.
      case 'mcp':
        return form.tools.gateway.length > 0 || form.tools.direct.length > 0;
      case 'builtin':
        return form.tools.custom.length > 0;
      case 'subagent':
        return form.tools.subagents.length > 0 || form.tools.callableAgents.length > 0;
      case 'skills':
        return form.selectedSkillIds.length > 0;
      case 'knowledge':
        return form.selectedKbScope === 'USER' || form.selectedKbResources.length > 0;
      default:
        return false;
    }
  };

  useEffect(() => {
    const incoming = [writingHubRow, attentionHubRow].filter(
      (row): row is AgentCreateHubRow => row !== null,
    );
    if (incoming.length === 0) return;
    setAddedRows(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const row of incoming) {
        if (!next.has(row)) {
          next.add(row);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // The chat is writing to this row again, so it is no longer removed.
    setRemovedRows(prev => {
      if (!incoming.some(row => prev.has(row))) return prev;
      const next = new Set(prev);
      for (const row of incoming) next.delete(row);
      return next;
    });
  }, [attentionHubRow, writingHubRow]);

  const rowHasSuggestions = (row: AgentCreateHubRow): boolean => {
    if (!hubSuggestions) return false;
    switch (row) {
      case 'mcp':
        return hubSuggestions.mcp.length > 0;
      case 'builtin':
        return hubSuggestions.builtin.length > 0;
      case 'subagent':
        return hubSuggestions.subagents.length > 0;
      case 'skills':
        return hubSuggestions.skills.length > 0;
      case 'knowledge':
        return hubSuggestions.knowledge.length > 0;
      default:
        return false;
    }
  };
  // A row that has shown up (the chat filled it, or suggested something for it)
  // stays on the canvas when its last pill is removed; only the row's own
  // Remove takes it away. Pin every visible row into `addedRows` so it survives.
  const visibleByContent = HUB_ROWS.filter(
    row => rowHasContent(row) || (!removedRows.has(row) && rowHasSuggestions(row)),
  ).join(',');
  useEffect(() => {
    if (!visibleByContent) return;
    const rows = visibleByContent.split(',') as AgentCreateHubRow[];
    setAddedRows(prev => {
      if (rows.every(row => prev.has(row))) return prev;
      const next = new Set(prev);
      for (const row of rows) next.add(row);
      return next;
    });
    // Content arriving for a row the user removed brings the row back.
    setRemovedRows(prev => {
      if (!rows.some(row => prev.has(row))) return prev;
      const next = new Set(prev);
      for (const row of rows) next.delete(row);
      return next;
    });
  }, [visibleByContent]);

  const showHubRow = (row: AgentCreateHubRow): boolean => {
    if (!isProfile) return true;
    // A removed row stays hidden until something is picked for it again.
    if (removedRows.has(row) && !rowHasContent(row)) return false;
    return addedRows.has(row) || rowHasContent(row) || rowHasSuggestions(row);
  };

  /** Empties what the row owns, then hides it; Add property or the chat brings it back. */
  const removeHubRow = (row: AgentCreateHubRow): void => {
    switch (row) {
      case 'mcp':
        onFormChange({ tools: { ...form.tools, gateway: [], direct: [] } });
        break;
      case 'builtin':
        onFormChange({ tools: { ...form.tools, custom: [] } });
        break;
      case 'subagent':
        onFormChange({ tools: { ...form.tools, subagents: [], callableAgents: [] } });
        break;
      case 'skills':
        onFormChange({ selectedSkillIds: [] });
        break;
      case 'knowledge':
        onFormChange({ selectedKbScope: 'COLLECTIONS', selectedKbResources: [] });
        break;
    }
    setRemovedRows(prev => new Set(prev).add(row));
    setAddedRows(prev => {
      const next = new Set(prev);
      next.delete(row);
      return next;
    });
  };

  const removeRowItem = (row: AgentCreateHubRow): ReactElement => (
    <DropdownMenuItem
      className={PROPERTY_MENU_ITEM}
      onSelect={() => removeHubRow(row)}
      data-testid={`property-remove-${row}`}
    >
      Remove
    </DropdownMenuItem>
  );

  const isAnticipating = (field: AgentCreateField): boolean =>
    attentionField === field && writingField !== field;
  const isWriting = (field: AgentCreateField): boolean =>
    writingField === field || highlights.has(field);
  const isShimmering = (field: AgentCreateField): boolean =>
    isWriting(field) || isAnticipating(field);
  const isHubShimmering = (row: AgentCreateHubRow): boolean => {
    if (writingHubRow === row) return true;
    if (attentionHubRow === row && writingHubRow !== row) return true;
    return false;
  };
  const activeWrite = writingField ?? attentionField ?? [...highlights][0] ?? '';
  const fieldClass =
    'w-full resize-y border-0 border-b border-border bg-transparent px-0 py-2 text-sm leading-6 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0 disabled:opacity-60';
  const plainField =
    'w-full resize-none border-0 bg-transparent p-0 text-sm leading-6 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0 disabled:opacity-60';

  return (
    <MotionConfig reducedMotion='user'>
      {/* Viewing: pills can't be opened or removed, but "+N more" still opens a row. */}
      <CapabilityPillsReadOnly.Provider value={viewOnly}>
        <CanvasEntranceContext.Provider value={entranceRoot}>
          <div
            ref={rootRef}
            className='relative flex h-full min-w-0 flex-col bg-background'
            data-component='AgentCreateCanvas'
            data-writing-field={activeWrite}
            data-attention-field={attentionField ?? ''}
            data-canvas-idle={skeletonIdentity || activeWrite ? 'false' : 'true'}
          >
            <div
              className={cn(
                'flex flex-shrink-0',
                // 860px column matches Xyne Scribe. pt-2.5 puts this row's vertical
                // center on the app-nav back/search controls (pt-5 sat ~10px low).
                isProfile
                  ? 'w-full flex-col items-center px-4'
                  : 'h-11 items-center justify-between px-5',
              )}
            >
              {isProfile && topBar ? (
                <div className='w-full max-w-[860px] bg-background pb-6 pt-2.5 sm:pb-3'>
                  {topBar}
                </div>
              ) : (
                <div
                  className={cn(
                    isProfile
                      ? 'grid max-w-[860px] w-full sticky top-0 z-20 grid-cols-[minmax(0,1fr)_auto] items-center bg-background pt-2.5 pb-6 sm:pb-3'
                      : 'flex w-full items-center justify-between',
                  )}
                >
                  <span
                    className={
                      isProfile
                        ? 'col-start-1 row-start-1 min-w-0 text-base font-semibold leading-7 text-foreground'
                        : 'text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground'
                    }
                  >
                    {isProfile ? title : 'Agent'}
                  </span>
                  <div
                    className={cn(
                      'flex items-center gap-2',
                      isProfile && 'col-start-2 row-start-1',
                    )}
                  >
                    {isProfile && onCancel ? (
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={onCancel}
                        disabled={saving || disabled}
                        data-track-category='AGENT_ARTIFACT'
                        data-track-name='CANCEL_CREATE_AGENT'
                        data-testid='create-agent-cancel'
                      >
                        Cancel
                      </Button>
                    ) : null}
                    {isProfile && onSave ? (
                      <SaveButton
                        onSave={onSave}
                        disabled={!canSave || Boolean(disabled)}
                        saving={saving}
                        blockedReason={disabled || saving ? null : (saveBlockedReason ?? null)}
                      />
                    ) : null}
                    {onClose ? (
                      <button
                        type='button'
                        onClick={onClose}
                        aria-label='Close'
                        className='rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                        data-track-category='AGENT_ARTIFACT'
                        data-track-name='CLOSE_AGENT_PREVIEW'
                      >
                        Close
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
            {isProfile && saveError ? (
              <div className='flex w-full flex-col items-center px-4'>
                <p
                  className='w-full max-w-[860px] pb-2 text-sm leading-5 text-destructive'
                  role='alert'
                >
                  {saveError}
                </p>
              </div>
            ) : null}
            <div
              className={cn(
                'flex-1 overflow-y-auto',
                isProfile ? 'flex min-h-0 flex-col items-center px-4 pb-10 pt-14' : 'px-6 py-6',
                // Room to scroll the last row clear of the docked chat.
                floatingChat ? 'pb-32' : null,
                // Viewing reads as the agent, not as a greyed-out form: disabled fields
                // keep full colour, and the Add buttons go (the rows are inert below).
                viewOnly && '[&_:disabled]:!opacity-100 [&_[data-property-add]]:hidden',
              )}
              data-view-only={viewOnly ? 'true' : undefined}
            >
              <div
                ref={columnRef}
                {...{ [CANVAS_COLUMN_ATTR]: '' }}
                className={cn(
                  'relative flex w-full flex-col',
                  isProfile ? 'max-w-[860px] gap-0' : 'mx-auto max-w-3xl gap-10',
                )}
              >
                {showIdentitySkeleton ? (
                  <IdentitySkeleton />
                ) : (
                  <>
                    {banner && isProfile ? (
                      <div className='order-0 mb-10 w-full'>{banner}</div>
                    ) : null}
                    <div
                      className={cn(
                        'flex min-w-0 items-center gap-4',
                        isProfile && 'order-1 mb-14',
                      )}
                    >
                      {isProfile
                        ? (avatar ?? (
                            <DraftAgentAvatar
                              avatarKey={avatarKey ?? (form.slug || form.name)}
                              busy={Boolean(saving) || writingField !== null}
                              size={56}
                            />
                          ))
                        : null}
                      <div className='flex min-w-0 flex-1 flex-col gap-2'>
                        <ChatFillHighlight
                          active={isShimmering('name')}
                          anticipating={isAnticipating('name')}
                          placement='inline'
                          field='name'
                        >
                          <div className='flex w-full items-center gap-2'>
                            <AutoWidthInput
                              id='agent-create-name'
                              value={form.name}
                              onChange={next =>
                                onFormChange({
                                  name: next,
                                  ...(form.slugManual ? {} : { slug: slugify(next) }),
                                })
                              }
                              onFocus={() => onFieldFocus('name')}
                              onBlur={() => onFieldFocus(null)}
                              placeholder={isProfile ? 'Name your agent' : 'Untitled'}
                              aria-label='Name'
                              disabled={disabled}
                              data-track-category='Claw Agents'
                              data-track-name='Create agent canvas: name'
                              className={cn(
                                'font-medium tracking-[-0.2px] text-foreground placeholder:font-medium',
                                isProfile
                                  ? 'text-[22px] leading-[26px] placeholder:text-fg-placeholder'
                                  : 'text-xl leading-7 placeholder:text-muted-foreground/70',
                              )}
                            />
                            {isProfile ? null : (
                              <PencilEditLine
                                className='size-3 shrink-0 text-muted-foreground'
                                aria-hidden
                              />
                            )}
                            {nameBadge}
                          </div>
                        </ChatFillHighlight>

                        <ChatFillHighlight
                          active={isShimmering('slug')}
                          anticipating={isAnticipating('slug')}
                          placement='inline'
                          field='slug'
                        >
                          <div className='flex items-center gap-1.5'>
                            <div className='flex items-center gap-0.5 py-0.5'>
                              <AtMark
                                className='size-4 shrink-0 text-muted-foreground'
                                aria-hidden
                              />
                              <AutoWidthInput
                                id='agent-create-handle'
                                value={form.slug}
                                onChange={raw => {
                                  const next = slugify(raw);
                                  onFormChange({ slugManual: next.length > 0, slug: next });
                                }}
                                onFocus={() => onFieldFocus('slug')}
                                onBlur={() => onFieldFocus(null)}
                                placeholder={isProfile ? 'Agent handle' : 'handle'}
                                aria-label='Handle'
                                disabled={disabled || handleLocked}
                                className={cn(
                                  'font-medium tracking-[-0.14px] placeholder:font-medium',
                                  isProfile
                                    ? 'text-[13px] leading-4 text-muted-foreground placeholder:text-fg-placeholder'
                                    : 'text-sm leading-5 text-foreground placeholder:text-muted-foreground/70',
                                )}
                              />
                            </div>
                            {checkingHandle && form.name.trim().length > 0 && (
                              <Loader2
                                className='size-3.5 animate-spin text-muted-foreground'
                                aria-hidden
                              />
                            )}
                            {handleMeta}
                          </div>
                        </ChatFillHighlight>

                        {handleError ? (
                          <p className='text-sm leading-5 text-destructive' role='alert'>
                            {handleError}
                          </p>
                        ) : null}

                        {builtBy && !isProfile ? (
                          <p className='flex items-center gap-1.5 text-sm leading-[1.5] text-muted-foreground'>
                            Built by
                            <span className='text-[color:var(--mention-color)]'>@{builtBy}</span>
                          </p>
                        ) : null}

                        {renderConflict('name')}
                        {renderConflict('slug')}
                      </div>
                      {isProfile && (identityActions || onOpenSettings) ? (
                        <div className='flex shrink-0 items-center gap-1.5 self-start'>
                          {identityActions}
                          {onOpenSettings ? (
                            <Tooltip content='Settings' side='bottom'>
                              <button
                                type='button'
                                onClick={onOpenSettings}
                                aria-label='Agent settings'
                                data-track-category='Claw Agents'
                                data-track-name='Agent profile: open settings'
                                data-testid='agent-open-settings'
                                className='flex size-8 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                              >
                                <Settings02 className='size-[18px]' aria-hidden />
                              </button>
                            </Tooltip>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {isProfile ? (
                      <div className='order-2 mb-14 flex w-full flex-col gap-4'>
                        <h2 className='text-sm font-medium leading-[1.1] tracking-[-0.28px] text-fg-section'>
                          Properties
                        </h2>
                        <div
                          className='relative flex w-full flex-col gap-4'
                          data-testid='agent-property-list'
                        >
                          <PropertyRow label={propertyLabel('description')}>
                            <ChatFillHighlight
                              active={isShimmering('description')}
                              anticipating={isAnticipating('description')}
                              placement='block'
                              field='description'
                            >
                              <textarea
                                id='agent-create-description'
                                value={form.description}
                                onChange={event =>
                                  onFormChange({ description: event.target.value })
                                }
                                onFocus={() => onFieldFocus('description')}
                                onBlur={() => onFieldFocus(null)}
                                disabled={disabled}
                                rows={1}
                                placeholder='Give a short description to your agent'
                                data-track-category='Claw Agents'
                                data-track-name='Create agent canvas: description'
                                className='block min-h-[1.3em] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm font-normal leading-[1.3] tracking-[-0.1px] text-foreground outline-none [field-sizing:content] placeholder:font-normal placeholder:text-fg-placeholder focus:ring-0 disabled:opacity-60'
                              />
                            </ChatFillHighlight>
                          </PropertyRow>
                          {renderConflict('description')}
                          <AnimatePresence initial={false} mode='popLayout'>
                            {showHubRow('mcp') ? (
                              <motion.div key='row-mcp' {...arriving('row-mcp')}>
                                <RowEntrance delay={rowDelay('row-mcp')}>
                                  <PropertyRow
                                    label={<span data-testid='property-label-mcp'>MCP</span>}
                                    align='start'
                                    menu={removeRowItem('mcp')}
                                    menuLabel='MCP'
                                    menuTestId='property-menu-mcp'
                                    menuDisabled={disabled}
                                  >
                                    <ChatFillHighlight
                                      active={isHubShimmering('mcp')}
                                      anticipating={
                                        attentionHubRow === 'mcp' && writingHubRow !== 'mcp'
                                      }
                                      field='tools'
                                    >
                                      <div data-create-hub-row='mcp'>
                                        <McpCapabilityRow
                                          layout='profile'
                                          selection={form.tools}
                                          onSelectionChange={tools =>
                                            onFormChange({
                                              tools: {
                                                ...tools,
                                                callableAgents: form.tools.callableAgents,
                                              },
                                            })
                                          }
                                          suggestContext={suggestContext}
                                          hubSuggestions={hubSuggestions}
                                          onSuggestionAccepted={id =>
                                            onHubSuggestionAccepted?.('mcp', id)
                                          }
                                          onPickDismissed={id => onHubPickDismissed?.('mcp', id)}
                                        />
                                      </div>
                                    </ChatFillHighlight>
                                  </PropertyRow>
                                </RowEntrance>
                              </motion.div>
                            ) : null}
                            {showHubRow('subagent') ? (
                              <motion.div key='row-subagent' {...arriving('row-subagent')}>
                                <RowEntrance delay={rowDelay('row-subagent')}>
                                  <PropertyRow
                                    label={
                                      <span data-testid='property-label-subagent'>Subagent</span>
                                    }
                                    align='start'
                                    menu={removeRowItem('subagent')}
                                    menuLabel='Subagent'
                                    menuTestId='property-menu-subagent'
                                    menuDisabled={disabled}
                                  >
                                    <ChatFillHighlight
                                      active={isHubShimmering('subagent')}
                                      anticipating={
                                        attentionHubRow === 'subagent' &&
                                        writingHubRow !== 'subagent'
                                      }
                                      field='tools'
                                    >
                                      <div data-create-hub-row='subagent'>
                                        <SubagentCapabilityRow
                                          layout='profile'
                                          selection={form.tools}
                                          onSelectionChange={tools =>
                                            onFormChange({
                                              tools: {
                                                ...tools,
                                                callableAgents: form.tools.callableAgents,
                                              },
                                            })
                                          }
                                          suggestContext={suggestContext}
                                          hubSuggestions={hubSuggestions}
                                          onSuggestionAccepted={id =>
                                            onHubSuggestionAccepted?.('subagent', id)
                                          }
                                          onPickDismissed={id =>
                                            onHubPickDismissed?.('subagent', id)
                                          }
                                        />
                                      </div>
                                    </ChatFillHighlight>
                                  </PropertyRow>
                                </RowEntrance>
                              </motion.div>
                            ) : null}
                            {showHubRow('builtin') ? (
                              <motion.div key='row-builtin' {...arriving('row-builtin')}>
                                <RowEntrance delay={rowDelay('row-builtin')}>
                                  <PropertyRow
                                    label={propertyLabel('builtin')}
                                    align='start'
                                    menu={removeRowItem('builtin')}
                                    menuLabel={propertyLabels.builtin}
                                    menuTestId='property-menu-builtin'
                                    menuDisabled={disabled}
                                  >
                                    <ChatFillHighlight
                                      active={isHubShimmering('builtin')}
                                      anticipating={
                                        attentionHubRow === 'builtin' && writingHubRow !== 'builtin'
                                      }
                                      field='tools'
                                    >
                                      <div data-create-hub-row='builtin'>
                                        <BuiltinCapabilityRow
                                          layout='profile'
                                          selection={form.tools}
                                          onSelectionChange={tools =>
                                            onFormChange({
                                              tools: {
                                                ...tools,
                                                callableAgents: form.tools.callableAgents,
                                              },
                                            })
                                          }
                                          suggestContext={suggestContext}
                                          hubSuggestions={hubSuggestions}
                                          onSuggestionAccepted={id =>
                                            onHubSuggestionAccepted?.('builtin', id)
                                          }
                                          onPickDismissed={id =>
                                            onHubPickDismissed?.('builtin', id)
                                          }
                                        />
                                      </div>
                                    </ChatFillHighlight>
                                  </PropertyRow>
                                </RowEntrance>
                              </motion.div>
                            ) : null}
                            {showHubRow('skills') ? (
                              <motion.div key='row-skills' {...arriving('row-skills')}>
                                <RowEntrance delay={rowDelay('row-skills')}>
                                  <PropertyRow
                                    label={<span data-testid='property-label-skills'>Skills</span>}
                                    menu={removeRowItem('skills')}
                                    menuLabel='Skills'
                                    menuTestId='property-menu-skills'
                                    menuDisabled={disabled}
                                  >
                                    <ChatFillHighlight
                                      active={isShimmering('skills') || isHubShimmering('skills')}
                                      anticipating={isAnticipating('skills')}
                                      field='skills'
                                    >
                                      <div data-create-hub-row='skills'>
                                        <SkillsCapabilityRow
                                          layout='profile'
                                          selectedIds={form.selectedSkillIds}
                                          onChange={selectedSkillIds =>
                                            onFormChange({ selectedSkillIds })
                                          }
                                          hubSuggestions={hubSuggestions}
                                          onSuggestionAccepted={id =>
                                            onHubSuggestionAccepted?.('skill', id)
                                          }
                                          onPickDismissed={id => onHubPickDismissed?.('skill', id)}
                                        />
                                      </div>
                                    </ChatFillHighlight>
                                  </PropertyRow>
                                </RowEntrance>
                              </motion.div>
                            ) : null}
                            {showHubRow('knowledge') ? (
                              <motion.div key='row-knowledge' {...arriving('row-knowledge')}>
                                <RowEntrance delay={rowDelay('row-knowledge')}>
                                  <PropertyRow
                                    label={
                                      <span data-testid='property-label-knowledge'>Knowledge</span>
                                    }
                                    align='start'
                                    menu={removeRowItem('knowledge')}
                                    menuLabel='Knowledge'
                                    menuTestId='property-menu-knowledge'
                                    menuDisabled={disabled}
                                  >
                                    <ChatFillHighlight
                                      active={
                                        isShimmering('knowledge') || isHubShimmering('knowledge')
                                      }
                                      anticipating={isAnticipating('knowledge')}
                                      field='knowledge'
                                    >
                                      <div data-create-hub-row='knowledge'>
                                        <KnowledgeCapabilityRow
                                          layout='profile'
                                          scope={form.selectedKbScope}
                                          onScopeChange={selectedKbScope =>
                                            onFormChange({ selectedKbScope })
                                          }
                                          grants={form.selectedKbResources}
                                          onGrantsChange={selectedKbResources =>
                                            onFormChange({ selectedKbResources })
                                          }
                                          hubSuggestions={hubSuggestions}
                                          onSuggestionAccepted={id =>
                                            onHubSuggestionAccepted?.('knowledge', id)
                                          }
                                          onPickDismissed={id =>
                                            onHubPickDismissed?.('knowledge', id)
                                          }
                                        />
                                      </div>
                                    </ChatFillHighlight>
                                  </PropertyRow>
                                </RowEntrance>
                              </motion.div>
                            ) : null}
                            {form.schedule ? (
                              <motion.div key='row-schedule' {...arriving('row-schedule')}>
                                <ScheduleRow
                                  schedule={form.schedule}
                                  disabled={disabled || scheduleLocked}
                                  shimmer={isShimmering('schedule')}
                                  onChange={schedule => onFormChange({ schedule })}
                                  onRemove={() => onFormChange({ schedule: null })}
                                />
                              </motion.div>
                            ) : null}
                            {customProperties.map(property => (
                              <motion.div
                                key={`prop-${property.id}`}
                                {...arriving(`prop-${property.id}`)}
                              >
                                <CustomPropertyRow
                                  property={property}
                                  disabled={disabled}
                                  onChange={next =>
                                    setCustomProperties(prev =>
                                      prev.map(row => (row.id === next.id ? next : row)),
                                    )
                                  }
                                  onRemove={() =>
                                    setCustomProperties(prev =>
                                      prev.filter(row => row.id !== property.id),
                                    )
                                  }
                                />
                              </motion.div>
                            ))}
                            {viewOnly ? null : (
                              <motion.div key='add-property' {...SLIDE_ONLY}>
                                <AddPropertyMenu
                                  added={
                                    new Set(
                                      (
                                        [
                                          'mcp',
                                          'builtin',
                                          'subagent',
                                          'skills',
                                          'knowledge',
                                        ] as const
                                      ).filter(row => showHubRow(row)),
                                    )
                                  }
                                  disabled={disabled}
                                  onAdd={row => {
                                    setAddedRows(prev => {
                                      const next = new Set(prev);
                                      next.add(row);
                                      return next;
                                    });
                                    setRemovedRows(prev => {
                                      if (!prev.has(row)) return prev;
                                      const next = new Set(prev);
                                      next.delete(row);
                                      return next;
                                    });
                                  }}
                                  onAddCustom={type =>
                                    setCustomProperties(prev => [
                                      ...prev,
                                      createCustomProperty(type),
                                    ])
                                  }
                                  onAddSchedule={
                                    form.schedule || scheduleLocked
                                      ? undefined
                                      : () => onFormChange({ schedule: defaultSchedule() })
                                  }
                                />
                              </motion.div>
                            )}
                            {note ? (
                              <motion.p
                                key='note'
                                {...SLIDE_ONLY}
                                className='text-sm leading-5 text-muted-foreground'
                              >
                                {note}
                              </motion.p>
                            ) : null}
                          </AnimatePresence>
                        </div>
                      </div>
                    ) : (
                      <ChatFillHighlight
                        active={isShimmering('description')}
                        anticipating={isAnticipating('description')}
                        placement='block'
                        field='description'
                      >
                        <div className='flex w-full flex-col gap-1'>
                          <label
                            htmlFor='agent-create-description'
                            className='text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground'
                          >
                            Description
                          </label>
                          <textarea
                            id='agent-create-description'
                            value={form.description}
                            onChange={event => onFormChange({ description: event.target.value })}
                            onFocus={() => onFieldFocus('description')}
                            onBlur={() => onFieldFocus(null)}
                            disabled={disabled}
                            placeholder='When to use this agent'
                            data-track-category='Claw Agents'
                            data-track-name='Create agent canvas: description'
                            className={cn(fieldClass, 'h-[72px]')}
                          />
                          {renderConflict('description')}
                        </div>
                      </ChatFillHighlight>
                    )}

                    {isProfile ? (
                      <div className='order-5 flex w-full flex-col gap-4'>
                        <label
                          htmlFor='agent-create-instructions'
                          className='text-sm font-medium leading-[1.1] tracking-[-0.28px] text-fg-section'
                        >
                          Instructions
                        </label>
                        <ChatFillHighlight
                          active={isShimmering('systemPrompt')}
                          anticipating={isAnticipating('systemPrompt')}
                          placement='block'
                          field='systemPrompt'
                        >
                          {writingField === 'systemPrompt' ? (
                            // The chat is writing: chunks blur in here, and the
                            // textarea comes back with the same text when it's done.
                            <InstructionsReveal
                              text={form.systemPrompt}
                              className='min-h-[1.5rem] w-full whitespace-pre-wrap break-words text-sm font-normal leading-6 text-foreground'
                            />
                          ) : (
                            <textarea
                              id='agent-create-instructions'
                              value={form.systemPrompt}
                              onChange={event => onFormChange({ systemPrompt: event.target.value })}
                              onFocus={() => onFieldFocus('systemPrompt')}
                              onBlur={() => onFieldFocus(null)}
                              // Viewing: read-only, so the instructions can still be selected and copied.
                              disabled={disabled && !viewOnly}
                              readOnly={viewOnly}
                              maxLength={20000}
                              placeholder='Give instructions to your agent'
                              data-track-category='Claw Agents'
                              data-track-name='Create agent canvas: instructions'
                              rows={1}
                              className={cn(
                                plainField,
                                'min-h-[1.5rem] font-normal [field-sizing:content] placeholder:font-normal placeholder:text-fg-placeholder',
                              )}
                            />
                          )}
                        </ChatFillHighlight>
                        {renderConflict('systemPrompt')}
                      </div>
                    ) : (
                      <ChatFillHighlight
                        active={isShimmering('systemPrompt')}
                        anticipating={isAnticipating('systemPrompt')}
                        placement='block'
                        field='systemPrompt'
                      >
                        <div className='flex w-full flex-col gap-1'>
                          <label
                            htmlFor='agent-create-instructions'
                            className='text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground'
                          >
                            Instructions
                          </label>
                          <textarea
                            id='agent-create-instructions'
                            value={form.systemPrompt}
                            onChange={event => onFormChange({ systemPrompt: event.target.value })}
                            onFocus={() => onFieldFocus('systemPrompt')}
                            onBlur={() => onFieldFocus(null)}
                            disabled={disabled}
                            maxLength={20000}
                            placeholder='How it should work'
                            data-track-category='Claw Agents'
                            data-track-name='Create agent canvas: instructions'
                            className={cn(fieldClass, 'min-h-[180px]')}
                          />
                          {renderConflict('systemPrompt')}
                        </div>
                      </ChatFillHighlight>
                    )}
                  </>
                )}

                {!isProfile ? (
                  <div className='flex flex-col gap-8'>
                    <div
                      className={cn(
                        'flex flex-col gap-8',
                        disabled && 'pointer-events-none opacity-60',
                        isProfile &&
                          !showHubRow('mcp') &&
                          !showHubRow('subagent') &&
                          !showHubRow('builtin') &&
                          'hidden',
                      )}
                      onFocus={() => onFieldFocus('tools')}
                      onBlur={() => onFieldFocus(null)}
                    >
                      {showHubRow('mcp') ? (
                        <ChatFillHighlight
                          active={isHubShimmering('mcp')}
                          anticipating={attentionHubRow === 'mcp' && writingHubRow !== 'mcp'}
                          field='tools'
                        >
                          <div data-create-hub-row='mcp'>
                            <McpCapabilityRow
                              selection={form.tools}
                              onSelectionChange={tools =>
                                onFormChange({
                                  tools: { ...tools, callableAgents: form.tools.callableAgents },
                                })
                              }
                              suggestContext={suggestContext}
                            />
                          </div>
                        </ChatFillHighlight>
                      ) : null}
                      {showHubRow('subagent') ? (
                        <ChatFillHighlight
                          active={isHubShimmering('subagent')}
                          anticipating={
                            attentionHubRow === 'subagent' && writingHubRow !== 'subagent'
                          }
                          field='tools'
                        >
                          <div data-create-hub-row='subagent'>
                            <SubagentCapabilityRow
                              selection={form.tools}
                              onSelectionChange={tools =>
                                onFormChange({
                                  tools: { ...tools, callableAgents: form.tools.callableAgents },
                                })
                              }
                              suggestContext={suggestContext}
                            />
                          </div>
                        </ChatFillHighlight>
                      ) : null}
                      {showHubRow('builtin') ? (
                        <ChatFillHighlight
                          active={isHubShimmering('builtin')}
                          anticipating={
                            attentionHubRow === 'builtin' && writingHubRow !== 'builtin'
                          }
                          field='tools'
                        >
                          <div data-create-hub-row='builtin'>
                            <BuiltinCapabilityRow
                              selection={form.tools}
                              onSelectionChange={tools =>
                                onFormChange({
                                  tools: { ...tools, callableAgents: form.tools.callableAgents },
                                })
                              }
                              suggestContext={suggestContext}
                            />
                          </div>
                        </ChatFillHighlight>
                      ) : null}
                      {renderConflict('tools')}
                    </div>

                    {showHubRow('skills') ? (
                      <ChatFillHighlight
                        active={isShimmering('skills') || isHubShimmering('skills')}
                        anticipating={isAnticipating('skills')}
                        field='skills'
                      >
                        <div
                          className={cn(disabled && 'pointer-events-none opacity-60')}
                          data-create-hub-row='skills'
                          onFocus={() => onFieldFocus('skills')}
                          onBlur={() => onFieldFocus(null)}
                        >
                          <SkillsCapabilityRow
                            selectedIds={form.selectedSkillIds}
                            onChange={selectedSkillIds => onFormChange({ selectedSkillIds })}
                          />
                          {renderConflict('skills')}
                        </div>
                      </ChatFillHighlight>
                    ) : null}

                    {showHubRow('knowledge') ? (
                      <ChatFillHighlight
                        active={isShimmering('knowledge') || isHubShimmering('knowledge')}
                        anticipating={isAnticipating('knowledge')}
                        field='knowledge'
                      >
                        <div
                          className={cn(disabled && 'pointer-events-none opacity-60')}
                          data-create-hub-row='knowledge'
                          onFocus={() => onFieldFocus('knowledge')}
                          onBlur={() => onFieldFocus(null)}
                        >
                          <KnowledgeCapabilityRow
                            scope={form.selectedKbScope}
                            onScopeChange={selectedKbScope => onFormChange({ selectedKbScope })}
                            grants={form.selectedKbResources}
                            onGrantsChange={selectedKbResources =>
                              onFormChange({ selectedKbResources })
                            }
                          />
                          {renderConflict('knowledge')}
                        </div>
                      </ChatFillHighlight>
                    ) : null}

                    {note ? (
                      <p className='text-sm leading-5 text-muted-foreground'>{note}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            {footer ? (
              <div className='flex-shrink-0 border-t border-border bg-foreground/[0.03] px-6 py-3'>
                {footer}
              </div>
            ) : null}
            {floatingChat}
          </div>
        </CanvasEntranceContext.Provider>
      </CapabilityPillsReadOnly.Provider>
    </MotionConfig>
  );
}
