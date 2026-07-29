import { ReactElement } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { SectionCaption } from '@/components/ClawAgents/SectionCaption';
import type { AgentNameCheck } from '@/hooks/useAgentNameCheck';
import { COLORS, slugify, type WizardState } from '../wizardState';

interface Props {
  state: WizardState;
  slug: string;
  nameCheck: AgentNameCheck;
  update: (patch: Partial<WizardState>) => void;
}

export function IdentityStep({ state, slug, nameCheck, update }: Props): ReactElement {
  const { name, description, color, slugManual } = state;
  const { checking, nameError, slugError, nameValid } = nameCheck;

  return (
    <div className='space-y-4'>
      <SectionCaption friendly='Identity' />
      {/* Name + handle share a row. */}
      <div className='grid grid-cols-12 gap-3'>
        <div className='col-span-7'>
          <label
            htmlFor='claw-agent-name'
            className='mb-1.5 block text-[12px] font-medium text-foreground/80'
          >
            Name
          </label>
          <div className='relative'>
            <input
              id='claw-agent-name'
              value={name}
              onChange={e =>
                update({
                  name: e.target.value,
                  ...(slugManual ? {} : { slug: slugify(e.target.value) }),
                })
              }
              placeholder='e.g. PR Reviewer, Onboarding Guide'
              autoFocus
              data-track-category='Claw Agents'
              data-track-name='Agent name input'
              className={cn(
                'w-full rounded-lg border bg-card px-3 py-2 pr-8 text-[14px] text-foreground placeholder:text-muted-foreground transition focus:outline-none focus:ring-2 focus:ring-ring/30',
                nameError
                  ? 'border-destructive'
                  : nameValid
                    ? 'border-emerald-500'
                    : 'border-border focus:border-ring',
              )}
            />
            {name.trim() && (
              <span className='absolute right-2.5 top-2.5'>
                {checking ? (
                  <Loader2 size={14} className='animate-spin text-muted-foreground' />
                ) : nameError ? (
                  <AlertCircle size={14} className='text-destructive' />
                ) : nameValid ? (
                  <Check size={14} className='text-emerald-500' />
                ) : null}
              </span>
            )}
          </div>
          {nameError && <p className='mt-1 text-[11px] text-destructive'>{nameError}</p>}
        </div>
        <div className='col-span-5'>
          <label
            htmlFor='claw-agent-handle'
            className='mb-1.5 flex items-center justify-between gap-2 text-[12px] font-medium text-foreground/80'
          >
            Handle
            <button
              type='button'
              onClick={() => update({ slugManual: !slugManual })}
              data-track-category='Claw Agents'
              data-track-name='Toggle agent handle edit'
              className='text-[11px] font-normal text-muted-foreground transition hover:text-foreground'
            >
              {slugManual ? 'auto' : 'edit'}
            </button>
          </label>
          <input
            id='claw-agent-handle'
            value={slug}
            onChange={e => update({ slugManual: true, slug: e.target.value })}
            disabled={!slugManual}
            data-track-category='Claw Agents'
            data-track-name='Agent handle input'
            className={cn(
              'w-full rounded-lg border bg-muted px-3 py-2 font-mono text-[13px] text-foreground/80 transition focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60',
              slugError ? 'border-destructive' : 'border-border focus:border-ring',
            )}
          />
          {slugError && <p className='mt-1 text-[11px] text-destructive'>{slugError}</p>}
        </div>
      </div>

      <div>
        <label
          htmlFor='claw-agent-description'
          className='mb-1.5 block text-[12px] font-medium text-foreground/80'
        >
          Description
        </label>
        <input
          id='claw-agent-description'
          value={description}
          onChange={e => update({ description: e.target.value })}
          placeholder='What does this agent do?'
          data-track-category='Claw Agents'
          data-track-name='Agent description input'
          className='w-full rounded-lg border border-border bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground transition focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30'
        />
      </div>

      <div>
        <span className='mb-1.5 block text-[12px] font-medium text-foreground/80'>Color</span>
        <div className='flex flex-wrap gap-2 px-2 py-2'>
          {COLORS.map(c => (
            <button
              key={c}
              type='button'
              onClick={() => update({ color: c })}
              aria-label={`Select color ${c}`}
              data-track-category='Claw Agents'
              data-track-name='Select agent color'
              className={cn(
                'h-7 w-7 rounded-full transition',
                color === c
                  ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                  : 'hover:scale-110',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
