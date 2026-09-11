import { ReactElement } from 'react';
import { Eye, Lock, Pencil } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { Button } from '@/components/ui/Button';
import { PromptVersionHistory } from '@/components/ClawAgents/PromptVersionHistory';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentPermissions } from '@/services/claw/agentPermissions';

interface PersonaTabProps {
  agent: Agent;
  permissions: AgentPermissions;
  draftName: string;
  onDraftNameChange: (value: string) => void;
  draftDescription: string;
  onDraftDescriptionChange: (value: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  isActualOwner: boolean;
  onRenameRequested: () => void;
}

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactElement;
}): ReactElement => (
  <div className='flex flex-col gap-1.5'>
    <label className='text-sm font-medium text-foreground'>{label}</label>
    {children}
    {hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
  </div>
);

/**
 * Persona tab — the agent's identity and system prompt. Every control is
 * read-only unless `permissions.canEdit`; edits flow up into the screen's draft
 * state and are persisted by the header's Save button. The handle is immutable
 * here (owner-only rename lands in a later phase).
 */
const PersonaTab = ({
  agent,
  permissions,
  draftName,
  onDraftNameChange,
  draftDescription,
  onDraftDescriptionChange,
  prompt,
  onPromptChange,
  isActualOwner,
  onRenameRequested,
}: PersonaTabProps): ReactElement => {
  const canEdit = permissions.canEdit;
  const readOnlyCls = cn(!canEdit && 'cursor-default bg-muted/40 text-muted-foreground');

  return (
    <div className='flex max-w-2xl flex-col gap-6'>
      {!canEdit && (
        <div className='flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'>
          <Eye className='size-4 shrink-0' />
          View-only access — you can’t edit this agent.
        </div>
      )}

      <Field label='Name'>
        <Input
          value={draftName}
          onChange={e => onDraftNameChange(e.target.value)}
          readOnly={!canEdit}
          placeholder='Agent name'
          className={readOnlyCls}
        />
      </Field>

      <Field label='Handle' hint='Reference used in APIs, mentions, and the agent URL.'>
        <div className='flex h-9 items-center justify-between rounded-md border border-border bg-muted/40 px-3'>
          <span className='truncate font-mono text-sm text-muted-foreground'>@{agent.slug}</span>
          {isActualOwner ? (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={onRenameRequested}
              data-track-category='Claw Agents'
              data-track-name='REQUEST_RENAME_PERSONA'
              className='h-7'
            >
              <Pencil className='size-3.5' /> Rename
            </Button>
          ) : (
            <Tooltip side='top' content='Only the owner can rename this handle'>
              <Lock className='size-3.5 shrink-0 text-muted-foreground' />
            </Tooltip>
          )}
        </div>
      </Field>

      <PromptVersionHistory
        agentSlug={agent.slug}
        canActivate={canEdit}
        onActivated={onPromptChange}
      />

      <Field label='Description' hint='A short summary shown on the agent card.'>
        <Input
          value={draftDescription}
          onChange={e => onDraftDescriptionChange(e.target.value)}
          readOnly={!canEdit}
          placeholder='What does this agent do?'
          className={readOnlyCls}
        />
      </Field>

      <Field label='System prompt' hint='The voice and constraints that shape every reply.'>
        <div className='flex flex-col gap-1'>
          <Textarea
            value={prompt}
            onChange={e => onPromptChange(e.target.value)}
            readOnly={!canEdit}
            placeholder='Describe how this agent should behave…'
            className={cn('min-h-[240px] font-mono text-[13px] leading-relaxed', readOnlyCls)}
          />
          <span className='self-end text-xs tabular-nums text-muted-foreground'>
            {prompt.length} chars
          </span>
        </div>
      </Field>
    </div>
  );
};

export default PersonaTab;
