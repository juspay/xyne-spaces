import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AtMark, PencilEditLine } from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/utils/classNames';
import { AutoWidthInput } from '@/routes/AIScreen/library/shared/primitives/AutoWidthInput';
import { BuiltinCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/builtin/BuiltinCapabilityRow';
import { KnowledgeCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/knowledge/KnowledgeCapabilityRow';
import { McpCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/mcp/McpCapabilityRow';
import { SkillsCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/skill/SkillsCapabilityRow';
import { SubagentCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/subagent/SubagentCapabilityRow';
import { slugify } from '@/routes/ClawAgentsScreen/create/wizardState';
import { AgentBotAvatar } from '@/components/agents/AgentBotAvatar';
import { AddPropertyMenu } from './AddPropertyMenu';
import { ChatFillHighlight } from './ChatFillHighlight';
import { CustomPropertyRow } from './CustomPropertyRow';
import { EditablePropertyLabel } from './EditablePropertyLabel';
import { PropertyRow } from './PropertyRow';
import { createCustomProperty, type CustomProperty } from './customProperty';
import { WritingFieldPointer } from './WritingFieldPointer';
import type {
  AgentCreateConflict,
  AgentCreateField,
  AgentCreateFormState,
  AgentCreateHubRow,
  AgentCreatePhase,
  CreateHubSuggestions,
  HubPickKind,
} from './types';

function inlineWidth(value: string, placeholder: string): string {
  return `${Math.max(value.length, placeholder.length) - 2}ch`;
}

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
  /** Field currently being written by chat. Drives the traveling write pointer. */
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
      variant='default'
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
}: AgentCreateCanvasProps): ReactElement {
  const conflictByField = useMemo(
    () => new Map(conflicts.map(conflict => [conflict.field, conflict])),
    [conflicts],
  );
  const disabled = readOnly || phase === 'created' || phase === 'rejected';
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

  const columnRef = useRef<HTMLDivElement | null>(null);
  const showIdentitySkeleton = Boolean(skeletonIdentity);
  const isProfile = layout === 'profile';
  const [addedRows, setAddedRows] = useState<Set<AgentCreateHubRow>>(() => new Set());
  const [customProperties, setCustomProperties] = useState<CustomProperty[]>([]);
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
  const showHubRow = (row: AgentCreateHubRow): boolean =>
    !isProfile || addedRows.has(row) || rowHasContent(row) || rowHasSuggestions(row);
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
    <div
      className='flex h-full min-w-0 flex-col bg-background'
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
            {isProfile ? 'Create Agent' : 'Agent'}
          </span>
          <div className={cn('flex items-center gap-2', isProfile && 'col-start-2 row-start-1')}>
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
      </div>
      {isProfile && saveError ? (
        <div className='flex w-full flex-col items-center px-4'>
          <p className='w-full max-w-[860px] pb-2 text-sm leading-5 text-destructive' role='alert'>
            {saveError}
          </p>
        </div>
      ) : null}
      <div
        className={cn(
          'flex-1 overflow-y-auto',
          isProfile ? 'flex min-h-0 flex-col items-center px-4 pb-10 pt-14' : 'px-6 py-6',
        )}
      >
        <div
          ref={columnRef}
          className={cn(
            'relative flex w-full flex-col',
            isProfile ? 'max-w-[860px] gap-0' : 'mx-auto max-w-3xl gap-10',
          )}
        >
          {showIdentitySkeleton ? (
            <IdentitySkeleton />
          ) : (
            <>
              <div className={cn('flex min-w-0 items-center gap-4', isProfile && 'order-1 mb-14')}>
                {isProfile ? (
                  <AgentBotAvatar
                    type='clover'
                    agentKey={form.slug || form.name}
                    busy={Boolean(saving) || writingField !== null}
                    size={56}
                  />
                ) : null}
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
                        <AtMark className='size-4 shrink-0 text-muted-foreground' aria-hidden />
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
                          disabled={disabled}
                          style={{
                            width: inlineWidth(form.slug, isProfile ? 'Agent handle' : 'handle'),
                          }}
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
              </div>

              {isProfile ? (
                <div className='order-2 mb-14 flex w-full flex-col gap-4'>
                  <h2 className='text-sm font-medium leading-[1.1] tracking-[-0.28px] text-fg-section'>
                    Properties
                  </h2>
                  <div className='flex w-full flex-col gap-4' data-testid='agent-property-list'>
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
                          onChange={event => onFormChange({ description: event.target.value })}
                          onFocus={() => onFieldFocus('description')}
                          onBlur={() => onFieldFocus(null)}
                          disabled={disabled}
                          rows={1}
                          placeholder='Give a short description to your agent'
                          data-track-category='Claw Agents'
                          data-track-name='Create agent canvas: description'
                          className='block h-[1.3em] min-h-[1.3em] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm font-normal leading-[1.3] tracking-[-0.1px] text-foreground outline-none placeholder:font-normal placeholder:text-fg-placeholder focus:ring-0 disabled:opacity-60'
                        />
                      </ChatFillHighlight>
                    </PropertyRow>
                    {renderConflict('description')}
                    {showHubRow('mcp') ? (
                      <PropertyRow
                        label={<span data-testid='property-label-mcp'>MCP</span>}
                        align='start'
                      >
                        <ChatFillHighlight
                          active={isHubShimmering('mcp')}
                          anticipating={attentionHubRow === 'mcp' && writingHubRow !== 'mcp'}
                          field='tools'
                        >
                          <div data-create-hub-row='mcp'>
                            <McpCapabilityRow
                              layout='profile'
                              selection={form.tools}
                              onSelectionChange={tools =>
                                onFormChange({
                                  tools: { ...tools, callableAgents: form.tools.callableAgents },
                                })
                              }
                              suggestContext={suggestContext}
                              hubSuggestions={hubSuggestions}
                              onSuggestionAccepted={id => onHubSuggestionAccepted?.('mcp', id)}
                              onPickDismissed={id => onHubPickDismissed?.('mcp', id)}
                            />
                          </div>
                        </ChatFillHighlight>
                      </PropertyRow>
                    ) : null}
                    {showHubRow('subagent') ? (
                      <PropertyRow
                        label={<span data-testid='property-label-subagent'>Subagent</span>}
                        align='start'
                      >
                        <ChatFillHighlight
                          active={isHubShimmering('subagent')}
                          anticipating={
                            attentionHubRow === 'subagent' && writingHubRow !== 'subagent'
                          }
                          field='tools'
                        >
                          <div data-create-hub-row='subagent'>
                            <SubagentCapabilityRow
                              layout='profile'
                              selection={form.tools}
                              onSelectionChange={tools =>
                                onFormChange({
                                  tools: { ...tools, callableAgents: form.tools.callableAgents },
                                })
                              }
                              suggestContext={suggestContext}
                              hubSuggestions={hubSuggestions}
                              onSuggestionAccepted={id => onHubSuggestionAccepted?.('subagent', id)}
                              onPickDismissed={id => onHubPickDismissed?.('subagent', id)}
                            />
                          </div>
                        </ChatFillHighlight>
                      </PropertyRow>
                    ) : null}
                    {showHubRow('builtin') ? (
                      <PropertyRow label={propertyLabel('builtin')} align='start'>
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
                                  tools: { ...tools, callableAgents: form.tools.callableAgents },
                                })
                              }
                              suggestContext={suggestContext}
                              hubSuggestions={hubSuggestions}
                              onSuggestionAccepted={id => onHubSuggestionAccepted?.('builtin', id)}
                              onPickDismissed={id => onHubPickDismissed?.('builtin', id)}
                            />
                          </div>
                        </ChatFillHighlight>
                      </PropertyRow>
                    ) : null}
                    {showHubRow('skills') ? (
                      <PropertyRow label={<span data-testid='property-label-skills'>Skills</span>}>
                        <ChatFillHighlight
                          active={isShimmering('skills') || isHubShimmering('skills')}
                          anticipating={isAnticipating('skills')}
                          field='skills'
                        >
                          <div data-create-hub-row='skills'>
                            <SkillsCapabilityRow
                              layout='profile'
                              selectedIds={form.selectedSkillIds}
                              onChange={selectedSkillIds => onFormChange({ selectedSkillIds })}
                              hubSuggestions={hubSuggestions}
                              onSuggestionAccepted={id => onHubSuggestionAccepted?.('skill', id)}
                              onPickDismissed={id => onHubPickDismissed?.('skill', id)}
                            />
                          </div>
                        </ChatFillHighlight>
                      </PropertyRow>
                    ) : null}
                    {showHubRow('knowledge') ? (
                      <PropertyRow
                        label={<span data-testid='property-label-knowledge'>Knowledge</span>}
                        align='start'
                      >
                        <ChatFillHighlight
                          active={isShimmering('knowledge') || isHubShimmering('knowledge')}
                          anticipating={isAnticipating('knowledge')}
                          field='knowledge'
                        >
                          <div data-create-hub-row='knowledge'>
                            <KnowledgeCapabilityRow
                              layout='profile'
                              scope={form.selectedKbScope}
                              onScopeChange={selectedKbScope => onFormChange({ selectedKbScope })}
                              grants={form.selectedKbResources}
                              onGrantsChange={selectedKbResources =>
                                onFormChange({ selectedKbResources })
                              }
                              hubSuggestions={hubSuggestions}
                              onSuggestionAccepted={id =>
                                onHubSuggestionAccepted?.('knowledge', id)
                              }
                              onPickDismissed={id => onHubPickDismissed?.('knowledge', id)}
                            />
                          </div>
                        </ChatFillHighlight>
                      </PropertyRow>
                    ) : null}
                    {customProperties.map(property => (
                      <CustomPropertyRow
                        key={property.id}
                        property={property}
                        disabled={disabled}
                        onChange={next =>
                          setCustomProperties(prev =>
                            prev.map(row => (row.id === next.id ? next : row)),
                          )
                        }
                        onRemove={() =>
                          setCustomProperties(prev => prev.filter(row => row.id !== property.id))
                        }
                      />
                    ))}
                    <AddPropertyMenu
                      added={
                        new Set(
                          (['mcp', 'builtin', 'subagent', 'skills', 'knowledge'] as const).filter(
                            row => showHubRow(row),
                          ),
                        )
                      }
                      disabled={disabled}
                      onAdd={row => {
                        setAddedRows(prev => {
                          const next = new Set(prev);
                          next.add(row);
                          return next;
                        });
                      }}
                      onAddCustom={type =>
                        setCustomProperties(prev => [...prev, createCustomProperty(type)])
                      }
                    />
                    {note ? (
                      <p className='text-sm leading-5 text-muted-foreground'>{note}</p>
                    ) : null}
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
                    <textarea
                      id='agent-create-instructions'
                      value={form.systemPrompt}
                      onChange={event => onFormChange({ systemPrompt: event.target.value })}
                      onFocus={() => onFieldFocus('systemPrompt')}
                      onBlur={() => onFieldFocus(null)}
                      disabled={disabled}
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
                    anticipating={attentionHubRow === 'subagent' && writingHubRow !== 'subagent'}
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
                    anticipating={attentionHubRow === 'builtin' && writingHubRow !== 'builtin'}
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
                      onGrantsChange={selectedKbResources => onFormChange({ selectedKbResources })}
                    />
                    {renderConflict('knowledge')}
                  </div>
                </ChatFillHighlight>
              ) : null}

              {note ? <p className='text-sm leading-5 text-muted-foreground'>{note}</p> : null}
            </div>
          ) : null}
          <WritingFieldPointer field={writingField} hubRow={writingHubRow} originRef={columnRef} />
        </div>
      </div>
      {footer ? (
        <div className='flex-shrink-0 border-t border-border bg-foreground/[0.03] px-6 py-3'>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
