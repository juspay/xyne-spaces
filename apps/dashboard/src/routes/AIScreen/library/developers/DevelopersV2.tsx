import { type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { Code, PluginAddonDefault, TerminalConsoleSquare } from '@xyne/icons';
import { LibraryCard, LibraryIconTile } from '../shared/components/LibraryCard';
import { LibrarySections, LibraryTabShell } from '../shared/components/LibraryTabShell';
import { Pill, type PillTone } from '../shared/primitives/Pill';
import { DEVELOPER_TOOLS, type DeveloperToolId } from './developerTools';

export function DeveloperToolIcon({
  id,
  size = 'sm',
}: {
  id: DeveloperToolId;
  size?: 'sm' | 'md';
}): ReactElement {
  const Icon = id === 'mcp' ? PluginAddonDefault : id === 'cli' ? TerminalConsoleSquare : Code;
  return (
    <LibraryIconTile size={size}>
      <Icon className={size === 'md' ? 'size-5' : 'size-4'} aria-hidden />
    </LibraryIconTile>
  );
}

/** The read-only badge reads as reassurance; Inside/Outside Spaces are neutral labels. */
export function badgeTone(id: DeveloperToolId): PillTone {
  return id === 'mcp' ? 'success' : 'neutral';
}

/** Ways to build on Spaces: the MCP server, the SDK and the CLI. */
const DevelopersV2 = ({ query }: { query: string }): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);

  const q = query.trim().toLowerCase();
  const tools = DEVELOPER_TOOLS.filter(
    tool => !q || `${tool.name} ${tool.tagline}`.toLowerCase().includes(q),
  );

  return (
    <LibraryTabShell
      toolbar={null}
      isLoading={false}
      emptyState={
        tools.length === 0
          ? { icon: '🔍', title: 'No matching tools', description: 'Try a different search.' }
          : undefined
      }
    >
      <LibrarySections
        sections={[
          {
            key: 'build',
            label: 'Build on Spaces',
            items: tools.map(tool => (
              <LibraryCard
                key={tool.id}
                to={prefixWs(`/ai/library/developers/${tool.id}`)}
                testId='developer-tool-card'
                icon={<DeveloperToolIcon id={tool.id} />}
                name={tool.name}
                description={tool.tagline}
                meta={<Pill tone={badgeTone(tool.id)}>{tool.badge}</Pill>}
              />
            )),
          },
        ]}
      />
    </LibraryTabShell>
  );
};

export default DevelopersV2;
