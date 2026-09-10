import { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { SectionCaption } from '@/components/ClawAgents/SectionCaption';
import { KnowledgeBasePicker } from '@/components/ClawAgents/KnowledgeBasePicker/KnowledgeBasePicker';
import { useClawSkills } from '@/hooks/useClawSkills';
import { useAuth } from '@/hooks/useAuth';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import type { WizardState } from '../wizardState';

interface Props {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
}

const KB_SCOPES = [
  {
    value: 'COLLECTIONS' as const,
    label: 'Selected collections & files',
    hint: 'Pick an explicit allowlist. Same scope for everyone.',
  },
  {
    value: 'USER' as const,
    label: 'Match my access',
    hint: "Inherits the running user's spaces access — per session.",
  },
];

export function KnowledgeStep({ state, update }: Props): ReactElement {
  const { user } = useAuth();
  const userId = user?.id;
  const { data: skills, isLoading: skillsLoading } = useClawSkills();

  const selectedSkillIds = state.selectedSkillIds;
  const toggleSkill = (id: string): void =>
    update({
      selectedSkillIds: selectedSkillIds.includes(id)
        ? selectedSkillIds.filter(x => x !== id)
        : [...selectedSkillIds, id],
    });

  const allSkills = skills ?? [];
  const globalSkills = allSkills.filter(s => s.scope === 'global');
  const mySkills = allSkills.filter(s => s.ownerUserId === userId);

  const skillChip = (skill: Skill): ReactElement => (
    <button
      key={skill.id}
      type='button'
      onClick={() => toggleSkill(skill.id)}
      title={skill.description || skill.slug}
      data-track-category='Claw Agents'
      data-track-name='Toggle agent skill'
      className={cn(
        'rounded-full border px-2.5 py-1 text-[12px] transition',
        selectedSkillIds.includes(skill.id)
          ? 'border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] text-[var(--claw-ai-fg)]'
          : 'border-border bg-card text-foreground/80 hover:border-muted-foreground/40',
      )}
    >
      {skill.label || skill.name}
    </button>
  );

  return (
    <div className='space-y-4'>
      <SectionCaption friendly='Knowledge' technical='skills' />
      <p className='text-[13px] leading-relaxed text-foreground/80'>
        Skills give this agent reference knowledge it can draw on during a task — things like your
        coding conventions, writing style, or domain glossary. You can skip this and add skills
        later.
      </p>

      {skillsLoading ? (
        <div className='flex items-center gap-2 text-[13px] text-muted-foreground'>
          <Loader2 size={14} className='animate-spin' /> Loading…
        </div>
      ) : allSkills.length === 0 ? (
        <div className='rounded-lg border border-dashed border-border/60 px-3 py-8 text-center'>
          <p className='text-[13px] font-medium text-foreground/80'>No skills yet</p>
          <p className='mt-1 text-[12px] text-muted-foreground'>
            Create skills from the Skills page to attach reference material to your agents.
          </p>
        </div>
      ) : (
        <>
          {globalSkills.length > 0 && (
            <div>
              <p className='mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground'>
                Global skills
              </p>
              <div className='flex flex-wrap gap-1.5'>{globalSkills.map(skillChip)}</div>
            </div>
          )}
          {mySkills.length > 0 && (
            <div>
              <p className='mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground'>
                My skills
              </p>
              <div className='flex flex-wrap gap-1.5'>{mySkills.map(skillChip)}</div>
            </div>
          )}
          <p className='text-[11px] text-muted-foreground'>
            {selectedSkillIds.length === 0
              ? 'No skills attached — you can add them later from the agent settings.'
              : `${selectedSkillIds.length} skill${selectedSkillIds.length === 1 ? '' : 's'} attached`}
          </p>
        </>
      )}

      {/* Knowledge Base — COLLECTIONS (explicit allowlist) vs USER (inherit caller access). */}
      <div className='mt-6 space-y-2 border-t border-border/60 pt-5'>
        <SectionCaption friendly='Knowledge Base' technical='knowledge-base' />
        <p className='text-[13px] leading-relaxed text-foreground/80'>
          Attach spaces documents this agent can read. The agent automatically gets read-only tools
          (search, list, read) over the chosen scope.
        </p>

        <fieldset className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
          {KB_SCOPES.map(opt => {
            const selected = state.selectedKbScope === opt.value;
            return (
              <label
                key={opt.value}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 transition-colors',
                  selected ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-border',
                )}
              >
                <span className='flex items-center gap-2'>
                  <input
                    type='radio'
                    name='kb-scope-create'
                    value={opt.value}
                    checked={selected}
                    onChange={() => update({ selectedKbScope: opt.value })}
                    data-track-category='Claw Agents'
                    data-track-name='Select knowledge base scope'
                    className='h-3.5 w-3.5'
                  />
                  <span className='text-[13px] font-medium text-foreground'>{opt.label}</span>
                </span>
                <span className='pl-[22px] text-[11px] leading-snug text-muted-foreground'>
                  {opt.hint}
                </span>
              </label>
            );
          })}
        </fieldset>

        {state.selectedKbScope === 'USER' ? (
          <div className='rounded-lg border border-border/60 bg-muted/50 px-3 py-3'>
            <p className='text-[12px] leading-relaxed text-foreground/80'>
              This agent is scoped at the user level — its Knowledge Base reach is whatever the
              running user can already see in spaces. The per-collection picker is disabled.
            </p>
          </div>
        ) : (
          <>
            <KnowledgeBasePicker
              value={state.selectedKbResources}
              onChange={next => update({ selectedKbResources: next })}
            />
            <p className='text-[11px] text-muted-foreground'>
              {state.selectedKbResources.length === 0
                ? 'No KB resources attached — the agent will not be able to read documents.'
                : `${state.selectedKbResources.length} grant${state.selectedKbResources.length === 1 ? '' : 's'} attached`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
