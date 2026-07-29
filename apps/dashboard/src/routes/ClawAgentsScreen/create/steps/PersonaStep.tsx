import { ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCaption } from '@/components/ClawAgents/SectionCaption';
import { generateAgentPrompt } from '@/services/claw/clawAgentWizardService';
import type { WizardState } from '../wizardState';

interface Props {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
}

export function PersonaStep({ state, update }: Props): ReactElement {
  const generate = useMutation({
    mutationFn: generateAgentPrompt,
    onSuccess: prompt => {
      if (prompt) update({ systemPrompt: prompt });
    },
    onError: (err: Error) =>
      toast.error('Could not generate a prompt', { description: err.message }),
  });

  const runGenerate = (): void => {
    const intent = state.aiIntent.trim();
    if (!intent) return;
    generate.mutate({ intent, agentName: state.name });
  };

  return (
    <div className='space-y-4'>
      <SectionCaption friendly='Persona' technical='system prompt' />

      {/* Generate-with-AI bar. */}
      <div className='flex items-center gap-2.5 rounded-lg border border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] px-3 py-2'>
        <Sparkles size={13} className='shrink-0 text-[var(--claw-ai-fg)]' />
        <input
          value={state.aiIntent}
          onChange={e => update({ aiIntent: e.target.value })}
          placeholder='Describe what this agent should do…'
          onKeyDown={e => {
            if (e.key === 'Enter') runGenerate();
          }}
          data-track-category='Claw Agents'
          data-track-name='Persona AI intent input'
          className='min-w-0 flex-1 bg-transparent text-[12px] text-foreground placeholder:text-[var(--claw-ai-fg-muted)] focus:outline-none'
        />
        <button
          type='button'
          onClick={runGenerate}
          disabled={generate.isPending || !state.aiIntent.trim()}
          data-track-category='Claw Agents'
          data-track-name='Generate persona with AI'
          className='inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--claw-ai-solid)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[var(--claw-ai-solid-hover)] disabled:cursor-not-allowed disabled:opacity-40'
        >
          {generate.isPending && <Loader2 size={12} className='animate-spin' />}
          Generate with AI
        </button>
      </div>

      <div>
        <label
          htmlFor='claw-agent-system-prompt'
          className='mb-1.5 block text-[12px] font-medium text-foreground/80'
        >
          System prompt
        </label>
        <textarea
          id='claw-agent-system-prompt'
          value={state.systemPrompt}
          onChange={e => update({ systemPrompt: e.target.value })}
          placeholder='You are a…'
          rows={10}
          data-track-category='Claw Agents'
          data-track-name='Agent system prompt input'
          className='w-full resize-y rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30'
        />
        <p className='mt-1 text-[11px] text-muted-foreground'>
          {state.systemPrompt.length.toLocaleString()} characters
        </p>
      </div>
    </div>
  );
}
