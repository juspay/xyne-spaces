import { ReactElement, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { searchByNameThenDescription } from '../shared/librarySearch';
import { useAuth } from '@/hooks/useAuth';
import { useClawSkills } from '@/hooks/useClawSkills';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import { groupSkillsByCategory } from '@/services/claw/agentCategory';
import { LibraryCard, LibraryIconTile } from '../shared/components/LibraryCard';
import { LibraryFilterMenu } from '../shared/components/LibraryFilterMenu';
import {
  LibrarySections,
  LibraryTabShell,
  type LibraryEmptyState,
} from '../shared/components/LibraryTabShell';
import { LibraryToolbarPortal } from '../shared/components/LibraryToolbarSlot';
import { useCategoryFilter } from '../shared/hooks/useCategoryFilter';

const SkillsV2 = ({ query }: { query: string }): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);
  const { data, isLoading, isError, refetch } = useClawSkills();
  const skills = useMemo(() => data ?? [], [data]);

  const { user } = useAuth();
  const userId = user?.id;

  const q = query.trim();
  const searched = useMemo(
    () =>
      searchByNameThenDescription(skills, q, skill => ({
        name: skill.name || skill.slug,
        description: skill.description,
        ...(skill.slug && skill.slug !== skill.name ? { aliases: [skill.slug] as const } : {}),
      })),
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
              to={prefixWs(`/ai/library/skill/${encodeURIComponent(skill.slug)}?tab=overview`)}
              testId='claw-skill-card'
              dimmed={!skill.enabled}
              icon={<LibraryIconTile name={skill.name || skill.slug} />}
              name={skill.name || skill.slug}
              description={skill.description}
            />
          )),
        }))}
      />
    </LibraryTabShell>
  );
};

export default SkillsV2;
