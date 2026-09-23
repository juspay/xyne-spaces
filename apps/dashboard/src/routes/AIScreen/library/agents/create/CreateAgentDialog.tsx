import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button/index';
import { useAgentNameCheck } from '@/hooks/useAgentNameCheck';
import type { AgentDraftSeed } from '../../../screens/AIAgentCreateScreen';
import {
  COLORS,
  INITIAL_WIZARD_STATE,
  effectiveSlug,
  slugify,
  type WizardState,
} from '../../../../ClawAgentsScreen/create/wizardState';
import { V2Dialog } from '../../shared/primitives/V2Dialog';

const FIELD =
  'w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring';

function openingColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)] ?? COLORS[0];
}

function freshDraft(): WizardState {
  return { ...INITIAL_WIZARD_STATE, color: openingColor() };
}

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAgentDialog({ open, onOpenChange }: CreateAgentDialogProps): ReactElement {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [state, setState] = useState<WizardState>(freshDraft);

  const update = useCallback(
    (patch: Partial<WizardState>) => setState(prev => ({ ...prev, ...patch })),
    [],
  );

  const name = state.name.trim();
  const slug = effectiveSlug(state);
  const nameCheck = useAgentNameCheck(name, slug);

  const color = state.color;

  const intent = state.systemPrompt.trim();

  const errors = useMemo(() => {
    const next: { name?: string; systemPrompt?: string } = {};
    if (!name) next.name = 'Give your agent a name.';
    else if (nameCheck.nameError) next.name = nameCheck.nameError;
    else if (!slug) next.name = 'This name has no usable handle — add a letter or number.';
    else if (nameCheck.slugError) next.name = nameCheck.slugError;
    if (!intent) next.systemPrompt = 'Tell the agent what it should do.';
    return next;
  }, [name, slug, intent, nameCheck.nameError, nameCheck.slugError]);

  const visibleNameError = nameCheck.nameError ?? nameCheck.slugError ?? undefined;
  const canCreate = Object.keys(errors).length === 0 && !nameCheck.checking;

  const reset = useCallback(() => {
    setState(freshDraft());
  }, []);

  const close = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset],
  );

  const submit = (): void => {
    const seed: AgentDraftSeed = { name, systemPrompt: intent, color };
    close(false);
    void navigate(`${workspaceId ? `/${workspaceId}` : ''}/ai/library/agent/create`, {
      state: { draftSeed: seed },
    });
  };

  return (
    <V2Dialog
      open={open}
      onOpenChange={close}
      title='Create agent'
      description='Name your agent and describe what it should do.'
      testId='create-agent-dialog'
      className='max-w-[460px]'
      footer={
        <>
          <Button
            variant='ghost'
            onClick={() => close(false)}
            className='rounded-xl'
            data-track-category='Claw Agents'
            data-track-name='Create agent dialog: cancel'
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canCreate}
            className='rounded-xl'
            data-track-category='Claw Agents'
            data-track-name='Create agent dialog: create'
          >
            Continue
          </Button>
        </>
      }
    >
      <div className='flex w-full flex-col gap-1.5'>
        <label
          htmlFor='create-agent-name'
          className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'
        >
          Name
        </label>
        <input
          id='create-agent-name'
          value={state.name}
          onChange={e => update({ name: e.target.value, slug: slugify(e.target.value) })}
          placeholder='Name your agent'
          aria-invalid={visibleNameError !== undefined}
          autoComplete='off'
          spellCheck={false}
          autoFocus
          data-track-category='Claw Agents'
          data-track-name='Create agent dialog: name'
          className={FIELD}
        />
        {visibleNameError && (
          <span className='text-xs leading-4 text-destructive'>{visibleNameError}</span>
        )}
      </div>

      <div className='flex w-full flex-col gap-1.5'>
        <label
          htmlFor='create-agent-prompt'
          className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'
        >
          What should it do?
        </label>
        <div className='w-full overflow-hidden rounded-xl border border-border bg-card focus-within:ring-1 focus-within:ring-ring'>
          <textarea
            id='create-agent-prompt'
            value={state.systemPrompt}
            onChange={e => update({ systemPrompt: e.target.value })}
            placeholder='Describe the job in a sentence or two.'
            data-track-category='Claw Agents'
            data-track-name='Create agent dialog: prompt'
            className='h-[132px] w-full resize-none bg-transparent px-3.5 py-2.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none'
          />
        </div>
      </div>
    </V2Dialog>
  );
}
