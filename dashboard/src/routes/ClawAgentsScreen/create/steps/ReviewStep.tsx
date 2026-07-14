import { ReactElement } from 'react';
import { SectionCaption } from '@/components/ClawAgents/SectionCaption';
import { useClawSkills } from '@/hooks/useClawSkills';
import type { WizardState } from '../wizardState';

interface Props {
  state: WizardState;
  slug: string;
  error: string | null;
}

const Pill = ({ children }: { children: ReactElement | string }): ReactElement => (
  <span className='rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground'>
    {children}
  </span>
);

export function ReviewStep({ state, slug, error }: Props): ReactElement {
  const { data: skills } = useClawSkills();
  const { tools, researchAgentProductId, researchAgentRepositoryId } = state;
  const hasResearch =
    researchAgentProductId ||
    researchAgentRepositoryId ||
    tools.custom.includes('query-codebase') ||
    tools.custom.includes('review-pull-request');

  return (
    <div className='space-y-4'>
      <SectionCaption friendly='Review' />

      {/* Identity preview card */}
      <div className='flex items-start gap-3 rounded-xl border border-border bg-card p-3'>
        <span
          className='inline-block h-8 w-8 shrink-0 rounded-full'
          style={{ backgroundColor: state.color }}
        />
        <div className='min-w-0 flex-1'>
          <h3 className='text-[14px] font-semibold text-foreground'>{state.name || 'Untitled'}</h3>
          <p className='font-mono text-[11px] text-muted-foreground'>{slug} · personal</p>
          {state.description && (
            <p className='mt-1 text-[12px] leading-relaxed text-foreground/80'>
              {state.description}
            </p>
          )}
        </div>
      </div>

      {/* Persona */}
      <div>
        <SectionCaption friendly='Persona' technical='system prompt' />
        <pre className='max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted p-3 font-mono text-[11px] leading-relaxed text-foreground/80'>
          {state.systemPrompt.slice(0, 500)}
          {state.systemPrompt.length > 500 ? '…' : ''}
        </pre>
      </div>

      {hasResearch && (
        <div>
          <SectionCaption friendly='Research Agent' technical='context' />
          <p className='text-[12px] text-foreground/80'>
            Product: {researchAgentProductId || 'None'} · Repository:{' '}
            {researchAgentRepositoryId || 'None'}
          </p>
        </div>
      )}

      {/* Toolbox summary */}
      {(tools.subagents.length > 0 || tools.direct.length > 0 || tools.custom.length > 0) && (
        <div>
          <SectionCaption friendly='Toolbox' technical='tools' />
          <div className='space-y-2'>
            {tools.subagents.length > 0 && (
              <div>
                <p className='mb-1 text-[11px] text-muted-foreground'>
                  Subagents · {tools.subagents.length}
                </p>
                <div className='flex flex-wrap gap-1'>
                  {tools.subagents.map(x => (
                    <Pill key={x}>{x}</Pill>
                  ))}
                </div>
              </div>
            )}
            {tools.direct.length > 0 && (
              <div>
                <p className='mb-1 text-[11px] text-muted-foreground'>
                  MCP Tools · {tools.direct.length}
                </p>
                <div className='flex flex-wrap gap-1'>
                  {tools.direct.map(x => (
                    <Pill key={x}>{x}</Pill>
                  ))}
                </div>
              </div>
            )}
            {tools.custom.length > 0 && (
              <div>
                <p className='mb-1 text-[11px] text-muted-foreground'>
                  Built-in · {tools.custom.length}
                </p>
                <div className='flex flex-wrap gap-1'>
                  {tools.custom.map(x => (
                    <Pill key={x}>{x}</Pill>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Knowledge summary */}
      {state.selectedSkillIds.length > 0 && (
        <div>
          <SectionCaption friendly='Knowledge' technical='skills' />
          <div className='flex flex-wrap gap-1'>
            {state.selectedSkillIds.map(id => {
              const s = skills?.find(x => x.id === id);
              return <Pill key={id}>{s?.label || s?.name || id}</Pill>;
            })}
          </div>
        </div>
      )}

      {error && (
        <p className='rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive'>
          {error}
        </p>
      )}
    </div>
  );
}
