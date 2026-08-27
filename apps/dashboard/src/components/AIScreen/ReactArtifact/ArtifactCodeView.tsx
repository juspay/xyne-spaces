import { useMemo, useState, type ReactElement } from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { File } from '@pierre/diffs/react';
import type { ReactArtifactPayload } from './ReactArtifact.types';
import { sandpackThemeName, toProjectFiles } from './ReactArtifact.utils';

/**
 * Source browser for a generated app: a file tree on the left, the selected
 * file's syntax-highlighted contents on the right.
 *
 * Shows the WHOLE project exactly as Sandpack compiles it — the agent's files
 * plus everything the renderer injects (the shadcn/ui set, the Tailwind shell,
 * the data bridge, the bootstrap entry). The agent's own files sort first so
 * they are not buried, but the injected ones are reachable: they are what the
 * app actually imports, so hiding them makes the project unreadable.
 */
export function ArtifactCodeView({ payload }: { payload: ReactArtifactPayload }): ReactElement {
  const [selected, setSelected] = useState<string>(payload.entry);
  const themeType = useMemo(() => sandpackThemeName(), []);

  // The full project as the bundler sees it: template files (package.json,
  // tsconfig) + injected preamble + the agent's own source.
  const projectFiles = useMemo(() => toProjectFiles(payload), [payload]);

  const authored = useMemo(() => new Set(payload.files.map(f => f.path)), [payload]);

  // Author's files first, then injected — each group alphabetical.
  const paths = useMemo(() => {
    const all = Object.keys(projectFiles);
    const rank = (p: string): number => (authored.has(p) ? 0 : 1);
    return all.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [projectFiles, authored]);

  const { model } = useFileTree({
    paths,
    initialSelectedPaths: [payload.entry],
    search: true,
    // Directories collapse to nothing useful in a 2–7 file project, so keep the
    // whole tree open rather than making the reader drill in.
    onSelectionChange: (selectedPaths: readonly string[]) => {
      const next = selectedPaths[0];
      // Directory rows report as selected too; ignore anything that isn't a file.
      if (next && projectFiles[next]) setSelected(next);
    },
  });

  const file = useMemo(() => {
    const path = projectFiles[selected] ? selected : payload.entry;
    const entry = projectFiles[path];
    return entry ? { path, content: entry.code } : undefined;
  }, [projectFiles, selected, payload.entry]);

  return (
    <div className='flex h-full min-h-0'>
      <div className='w-56 shrink-0 overflow-auto border-r border-border'>
        <FileTree model={model} style={{ height: '100%' }} />
      </div>
      <div className='min-w-0 flex-1 overflow-auto'>
        {file && (
          <File
            // Remount on file change: the component caches highlighted output
            // per instance, so reusing it across files can show stale content.
            key={file.path}
            file={{ name: file.path, contents: file.content }}
            options={{ themeType, stickyHeader: true, overflow: 'scroll' }}
          />
        )}
      </div>
    </div>
  );
}
