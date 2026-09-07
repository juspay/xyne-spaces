import { useMemo, useState, type ReactElement } from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { File } from '@pierre/diffs/react';
import type { ReactArtifactPayload } from './ReactArtifact.types';
import { toProjectFiles } from './ReactArtifact.utils';
import { useDiffsTheme } from '../../flowUI/nodes/useDiffsTheme';

/** Sandpack addresses project files absolutely (`/App.tsx`), but the tree splits
 *  on `/` — a leading slash makes an empty first segment, so every file lands
 *  under a directory whose name is `''` and the panel opens on a single blank
 *  chevron row. Template files like `tsconfig.json` arrive without the slash, so
 *  this is not reversible by prefixing; callers map back through
 *  `projectPathByTreePath`. */
const toTreePath = (path: string): string => (path.startsWith('/') ? path.slice(1) : path);

/** The search field otherwise sits flush against the top of the panel. Injected
 *  through the tree's own `unsafeCSS` because the row lives in a shadow root
 *  that outside stylesheets cannot reach; `--trees-padding-inline` is the same
 *  16px the row already uses horizontally. */
const SEARCH_ROW_CSS =
  '[data-file-tree-search-container] { padding-block-start: var(--trees-padding-inline); }';

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
  const { themeType } = useDiffsTheme();

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

  const treePaths = useMemo(() => paths.map(toTreePath), [paths]);

  const projectPathByTreePath = useMemo(() => new Map(paths.map(p => [toTreePath(p), p])), [paths]);

  const { model } = useFileTree({
    paths: treePaths,
    initialSelectedPaths: [toTreePath(payload.entry)],
    search: true,
    unsafeCSS: SEARCH_ROW_CSS,
    // Depth 2, not 1: a folder holding nothing but one folder renders as a
    // single flattened row (`components/ui`), so the tree's top row can be two
    // nodes deep. Anything below what the panel shows at the top stays shut.
    initialExpansion: 2,
    onSelectionChange: (selectedPaths: readonly string[]) => {
      const next = selectedPaths[0];
      const path = next ? projectPathByTreePath.get(next) : undefined;
      // Directory rows report as selected too; ignore anything that isn't a file.
      if (path && projectFiles[path]) setSelected(path);
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
        <FileTree
          model={model}
          // `@pierre/trees` takes no theme prop: its shadow stylesheet derives
          // every color through `light-dark()` under `:host { color-scheme:
          // light dark }`, so the tree follows the OS preference instead of
          // ours. Pinning `color-scheme` on the host beats that rule (outer-tree
          // declarations win) and lands `light-dark()` on the editor's side.
          style={{ height: '100%', colorScheme: themeType }}
        />
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
