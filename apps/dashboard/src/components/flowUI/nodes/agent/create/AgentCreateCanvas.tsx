import { useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import { AtMark, PencilEditLine } from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/utils/classNames';
import { AutoWidthInput } from '@/routes/AIScreen/library/shared/primitives/AutoWidthInput';
import { BuiltinCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/builtin/BuiltinCapabilityRow';
import { KnowledgeCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/knowledge/KnowledgeCapabilityRow';
import { McpCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/mcp/McpCapabilityRow';
import { SkillsCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/skill/SkillsCapabilityRow';
import { SubagentCapabilityRow } from '@/routes/AIScreen/library/shared/pickers/subagent/SubagentCapabilityRow';
import { slugify } from '@/routes/ClawAgentsScreen/create/wizardState';
import { ChatFillHighlight } from './ChatFillHighlight';
import { WritingFieldPointer } from './WritingFieldPointer';
import type {
  AgentCreateConflict,
  AgentCreateField,
  AgentCreateFormState,
  AgentCreateHubRow,
  AgentCreatePhase,
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
  readOnly,
  onClose,
  skeletonIdentity,
  writingField = null,
  writingHubRow = null,
  attentionField = null,
  attentionHubRow = null,
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

  return (
    <div
      className='flex h-full min-w-0 flex-col bg-background'
      data-component='AgentCreateCanvas'
      data-writing-field={activeWrite}
      data-attention-field={attentionField ?? ''}
      data-canvas-idle={skeletonIdentity || activeWrite ? 'false' : 'true'}
    >
      <div className='flex h-11 flex-shrink-0 items-center justify-between px-5'>
        <span className='text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground'>
          Agent
        </span>
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
      <div className='flex-1 overflow-y-auto px-6 py-6'>
        <div ref={columnRef} className='relative mx-auto flex w-full max-w-3xl flex-col gap-10'>
          {showIdentitySkeleton ? (
            <IdentitySkeleton />
          ) : (
            <>
              <div className='flex min-w-0 flex-col gap-2'>
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
                      placeholder='Untitled'
                      aria-label='Name'
                      disabled={disabled}
                      data-track-category='Claw Agents'
                      data-track-name='Create agent canvas: name'
                      className='text-xl font-medium leading-7 tracking-[-0.2px] text-foreground placeholder:font-medium placeholder:text-muted-foreground/70'
                    />
                    <PencilEditLine className='size-3 shrink-0 text-muted-foreground' aria-hidden />
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
                        placeholder='handle'
                        aria-label='Handle'
                        disabled={disabled}
                        style={{ width: inlineWidth(form.slug, 'handle') }}
                        className='text-sm font-medium leading-5 tracking-[-0.14px] text-foreground placeholder:font-medium placeholder:text-muted-foreground/70'
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

                {builtBy ? (
                  <p className='flex items-center gap-1.5 text-sm leading-[1.5] text-muted-foreground'>
                    Built by
                    <span className='text-[color:var(--mention-color)]'>@{builtBy}</span>
                  </p>
                ) : null}

                {renderConflict('name')}
                {renderConflict('slug')}
              </div>

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
            </>
          )}

          <>
            <div
              className={cn('flex flex-col gap-8', disabled && 'pointer-events-none opacity-60')}
              onFocus={() => onFieldFocus('tools')}
              onBlur={() => onFieldFocus(null)}
            >
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
              {renderConflict('tools')}
            </div>

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

            {note ? <p className='text-sm leading-5 text-muted-foreground'>{note}</p> : null}
          </>
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
