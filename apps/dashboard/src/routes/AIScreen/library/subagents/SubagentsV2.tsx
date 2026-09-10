import { ReactElement, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Network } from 'lucide-react';
import { searchByNameThenDescription } from '../shared/librarySearch';
import { useClawSubagents } from '@/hooks/useClawSubagents';
import type { SubagentDef, SubagentSource } from '@/services/claw/clawSubagentsTypes';
import { LibraryCard, LibraryIconTile } from '../shared/components/LibraryCard';
import { LibraryFilterMenu } from '../shared/components/LibraryFilterMenu';
import {
  LibrarySections,
  LibraryTabShell,
  type LibraryEmptyState,
} from '../shared/components/LibraryTabShell';
import { LibraryToolbarPortal } from '../shared/components/LibraryToolbarSlot';

const bySource = (items: SubagentDef[], source: SubagentSource): SubagentDef[] =>
  items.filter(s => s.source === source).sort((a, b) => a.name.localeCompare(b.name));

const SubagentsV2 = ({ query }: { query: string }): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);
  const { data, isLoading, isError, refetch } = useClawSubagents();
  const subagents = useMemo(() => data ?? [], [data]);

  const [searchParams, setSearchParams] = useSearchParams();
  const rawSource = searchParams.get('source');
  const activeSource: SubagentSource | null =
    rawSource === 'custom' || rawSource === 'builtin' ? rawSource : null;

  const setActiveSource = (id: string | null): void => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('source', id);
    else next.delete('source');
    setSearchParams(next, { replace: true });
  };

  const q = query.trim();
  const searched = useMemo(
    () =>
      searchByNameThenDescription(subagents, q, subagent => ({
        name: subagent.name,
        description: subagent.description,
      })),
    [subagents, q],
  );

  const custom = useMemo(() => bySource(searched, 'custom'), [searched]);
  const builtIn = useMemo(() => bySource(searched, 'builtin'), [searched]);

  const options = useMemo(
    () => [
      { id: 'all', label: 'All', count: searched.length },
      { id: 'custom', label: 'Custom', count: custom.length },
      { id: 'builtin', label: 'Built-in', count: builtIn.length },
    ],
    [searched.length, custom.length, builtIn.length],
  );

  const sections = useMemo(
    () =>
      [
        { key: 'custom', label: 'Custom', items: custom },
        { key: 'builtin', label: 'Built-in', items: builtIn },
      ]
        .filter(section => !activeSource || section.key === activeSource)
        .filter(section => section.items.length > 0),
    [custom, builtIn, activeSource],
  );

  const emptyState: LibraryEmptyState | undefined =
    subagents.length === 0
      ? {
          icon: '🧩',
          title: 'No subagents yet',
          description: 'Subagents you have access to will show up here.',
        }
      : sections.length === 0
        ? {
            icon: '🔍',
            title: 'No matching subagents',
            description: 'Try a different search or type.',
          }
        : undefined;

  return (
    <LibraryTabShell
      toolbar={
        <LibraryToolbarPortal>
          <LibraryFilterMenu
            title='Type'
            options={options}
            activeId={activeSource}
            onSelect={setActiveSource}
            trackName='Subagents filter'
          />
        </LibraryToolbarPortal>
      }
      isLoading={isLoading}
      error={
        isError ? { message: "Couldn't load subagents.", onRetry: () => void refetch() } : undefined
      }
      emptyState={emptyState}
    >
      <LibrarySections
        sections={sections.map(section => ({
          key: section.key,
          label: section.label,
          items: section.items.map(subagent => {
            return (
              <LibraryCard
                key={subagent.name}
                to={prefixWs(
                  `/ai/library/subagent/${encodeURIComponent(subagent.name)}?tab=persona`,
                )}
                testId='claw-subagent-card'
                dimmed={!subagent.enabled}
                icon={
                  <LibraryIconTile>
                    <Network className='size-4' />
                  </LibraryIconTile>
                }
                name={subagent.name}
                description={subagent.description}
              />
            );
          }),
        }))}
      />
    </LibraryTabShell>
  );
};

export default SubagentsV2;
