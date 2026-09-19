import { useMemo, type ReactElement, type ReactNode } from 'react';
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
import type {
  AgentCreateConflict,
  AgentCreateField,
  AgentCreateFormState,
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

function CanvasSkeleton(): ReactElement {
  return (
    <div className='flex flex-col gap-8' aria-busy='true' aria-label='Drafting the agent'>
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-6 w-48' />
        <Skeleton className='h-8 w-36 rounded-[10px]' />
        <Skeleton className='h-4 w-40' />
      </div>
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-4 w-24' />
        <Skeleton className='h-[86px] w-full rounded-2xl' />
      </div>
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-4 w-28' />
        <Skeleton className='h-[180px] w-full rounded-2xl' />
      </div>
      {['MCP', 'Tools', 'Skills', 'Knowledge'].map(label => (
        <div key={label} className='flex flex-col gap-2'>
          <Skeleton className='h-4 w-20' />
          <Skeleton className='h-4 w-64' />
          <Skeleton className='h-8 w-32 rounded-[10px]' />
        </div>
      ))}
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

  return (
    <div className='flex h-full min-w-0 flex-col bg-background' data-component='AgentCreateCanvas'>
      <div className='flex h-14 flex-shrink-0 items-center justify-between border-b border-border px-5'>
        <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
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
      <div className='flex-1 overflow-y-auto px-6 py-5'>
        <div className='mx-auto flex w-full max-w-3xl flex-col gap-8'>
          {phase === 'loading' ? (
            <CanvasSkeleton />
          ) : (
            <>
              <ChatFillHighlight active={highlights.has('name') || highlights.has('slug')}>
                <div className='flex min-w-0 flex-col gap-1.5'>
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
                      placeholder='Name your agent'
                      aria-label='Name'
                      disabled={disabled}
                      data-track-category='Claw Agents'
                      data-track-name='Create agent canvas: name'
                      className='text-base font-medium leading-6 tracking-[-0.1px] text-foreground placeholder:font-medium placeholder:text-muted-foreground'
                    />
                    <PencilEditLine className='size-3 shrink-0 text-muted-foreground' aria-hidden />
                  </div>

                  <div className='flex items-center gap-1.5'>
                    <div className='flex items-center gap-0.5 rounded-[10px] bg-muted py-0.5 pl-0.5 pr-1'>
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
                        className='text-sm font-medium leading-5 tracking-[-0.14px] text-foreground placeholder:font-medium placeholder:text-muted-foreground'
                      />
                    </div>
                    {checkingHandle && form.name.trim().length > 0 && (
                      <Loader2
                        className='size-3.5 animate-spin text-muted-foreground'
                        aria-hidden
                      />
                    )}
                  </div>

                  {handleError ? (
                    <p className='text-sm leading-5 text-destructive' role='alert'>
                      {handleError}
                    </p>
                  ) : null}

                  {builtBy ? (
                    <p className='flex items-center gap-1.5 text-sm leading-[1.5] text-foreground'>
                      Built by
                      <span className='text-[color:var(--mention-color)]'>@{builtBy}</span>
                    </p>
                  ) : null}

                  {renderConflict('name')}
                  {renderConflict('slug')}
                </div>
              </ChatFillHighlight>

              <ChatFillHighlight active={highlights.has('description')}>
                <div className='flex w-full flex-col gap-3'>
                  <label
                    htmlFor='agent-create-description'
                    className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'
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
                    className='h-[86px] w-full resize-y rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60'
                  />
                  {renderConflict('description')}
                </div>
              </ChatFillHighlight>

              <ChatFillHighlight active={highlights.has('systemPrompt')}>
                <div className='flex w-full flex-col gap-3'>
                  <label
                    htmlFor='agent-create-instructions'
                    className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'
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
                    className='min-h-[180px] w-full resize-y rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60'
                  />
                  {renderConflict('systemPrompt')}
                </div>
              </ChatFillHighlight>

              <ChatFillHighlight active={highlights.has('tools')}>
                <div
                  className={cn(
                    'flex flex-col gap-8',
                    disabled && 'pointer-events-none opacity-60',
                  )}
                  onFocus={() => onFieldFocus('tools')}
                  onBlur={() => onFieldFocus(null)}
                >
                  <McpCapabilityRow
                    selection={form.tools}
                    onSelectionChange={tools =>
                      onFormChange({
                        tools: { ...tools, callableAgents: form.tools.callableAgents },
                      })
                    }
                    suggestContext={suggestContext}
                  />
                  <SubagentCapabilityRow
                    selection={form.tools}
                    onSelectionChange={tools =>
                      onFormChange({
                        tools: { ...tools, callableAgents: form.tools.callableAgents },
                      })
                    }
                    suggestContext={suggestContext}
                  />
                  <BuiltinCapabilityRow
                    selection={form.tools}
                    onSelectionChange={tools =>
                      onFormChange({
                        tools: { ...tools, callableAgents: form.tools.callableAgents },
                      })
                    }
                    suggestContext={suggestContext}
                  />
                  {renderConflict('tools')}
                </div>
              </ChatFillHighlight>

              <ChatFillHighlight active={highlights.has('skills')}>
                <div
                  className={cn(disabled && 'pointer-events-none opacity-60')}
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

              <ChatFillHighlight active={highlights.has('knowledge')}>
                <div
                  className={cn(disabled && 'pointer-events-none opacity-60')}
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
          )}
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
