import { ReactElement, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useClawSkills } from '@/hooks/useClawSkills';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import { groupSkillsByCategory } from '@/services/claw/agentCategory';
import { LibraryCard, LibraryIconTile, LibraryStatusDot } from '../shared/components/LibraryCard';
import { LibraryFilterMenu } from '../shared/components/LibraryFilterMenu';
import {
  LibrarySections,
  LibraryTabShell,
  type LibraryEmptyState,
} from '../shared/components/LibraryTabShell';
import { LibraryToolbarPortal } from '../shared/components/LibraryToolbarSlot';
import { useCategoryFilter } from '../shared/hooks/useCategoryFilter';

const getSourceLabel = (source: string): string => {
  switch (source) {
    case 'seeded':
      return 'Built-in';
    case 'user-created':
      return 'Custom';
    case 'uploaded':
      return 'Uploaded';
    default:
      return source;
  }
};

const SkillsV2 = ({ query }: { query: string }): ReactElement => {
  const { data, isLoading, isError, refetch } = useClawSkills();
  const skills = useMemo(() => data ?? [], [data]);

  const { user } = useAuth();
  const userId = user?.id;

  const q = query.trim().toLowerCase();
  const searched = useMemo(
    () =>
      q
        ? skills.filter(s => `${s.name} ${s.slug} ${s.description ?? ''}`.toLowerCase().includes(q))
        : skills,
    [skills, q],
  );

  const { filtered, activeId, setActive, options } = useCategoryFilter({
    items: searched,
    groupBy: groupSkillsByCategory,
  });

  const sections = useMemo(() => {
    const mine: Skill[] = [];
    const global: Skill[] = [];
    for (const skill of filtered) {
      (skill.ownerUserId && skill.ownerUserId === userId ? mine : global).push(skill);
    }
    return [
      { key: 'mine', label: 'My skills', skills: mine },
      { key: 'global', label: 'Global', skills: global },
    ].filter(section => section.skills.length > 0);
  }, [filtered, userId]);

  const emptyState: LibraryEmptyState | undefined =
    skills.length === 0
      ? {
          icon: '🛠️',
          title: 'No skills yet',
          description: 'Skills you have access to will show up here.',
        }
      : sections.length === 0
        ? {
            icon: '🔍',
            title: 'No matching skills',
            description: 'Try a different search or category.',
          }
        : undefined;

  return (
    <LibraryTabShell
      toolbar={
        <LibraryToolbarPortal>
          <LibraryFilterMenu
            title='Categories'
            options={options}
            activeId={activeId}
            onSelect={setActive}
            trackName='Filter skills by category'
          />
        </LibraryToolbarPortal>
      }
      isLoading={isLoading}
      error={
        isError ? { message: "Couldn't load skills.", onRetry: () => void refetch() } : undefined
      }
      emptyState={emptyState}
    >
      <LibrarySections
        sections={sections.map(section => ({
          key: section.key,
          label: section.label,
          items: section.skills.map(skill => (
            <LibraryCard
              key={skill.id}
              to={`/claw-agents/skills/${skill.slug}`}
              testId='claw-skill-card'
              dimmed={!skill.enabled}
              icon={<LibraryIconTile name={skill.name || skill.slug} />}
              name={skill.name || skill.slug}
              meta={`${getSourceLabel(skill.source)} · ${skill.slug}`}
              statusDot={
                <LibraryStatusDot
                  enabled={skill.enabled}
                  enabledLabel='Active — agents can use this skill'
                  disabledLabel='Disabled — agents cannot use this skill'
                />
              }
              description={skill.description}
            />
          )),
        }))}
      />
    </LibraryTabShell>
  );
};

export default SkillsV2;
