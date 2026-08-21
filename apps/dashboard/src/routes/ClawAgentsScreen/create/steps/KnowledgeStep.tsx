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

      {/* Knowledge Base — no explicit scope choice. Attaching specific
          collections/files scopes the agent to that allowlist; leaving it
          empty falls back to matching the running user's own spaces access
          (computed at save time from whether selectedKbResources is empty). */}
      <div className='mt-6 space-y-2 border-t border-border/60 pt-5'>
        <SectionCaption friendly='Knowledge Base' technical='knowledge-base' />
        <p className='text-[13px] leading-relaxed text-foreground/80'>
          Attach spaces documents this agent can read. The agent automatically gets read-only tools
          (search, list, read) over the chosen scope.
        </p>

        <KnowledgeBasePicker
          value={state.selectedKbResources}
          onChange={next => update({ selectedKbResources: next })}
        />
        <p className='text-[11px] text-muted-foreground'>
          {state.selectedKbResources.length === 0
            ? "No specific KB resources attached — this agent will match your access (inherits the running user's spaces access)."
            : `${state.selectedKbResources.length} grant${state.selectedKbResources.length === 1 ? '' : 's'} attached`}
        </p>
      </div>
    </div>
  );
}
