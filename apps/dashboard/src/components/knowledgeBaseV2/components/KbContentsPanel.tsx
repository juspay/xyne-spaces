import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { ChevronBigDown, ChevronBigRight, FileText, FolderDefault, SearchBig } from '@xyne/icons';
import { CollectionTreeNode } from '../../knowledgeBase/tree/treeTypes';
import { HighlightedText } from '../../Canvas/CanvasRow';
import { cn } from '../../../utils/classNames';
import Tooltip from '../../ui/Tooltip';
import Input from '../../ui/Input';

// Styled to match the Canvas sidebar's grouped list (CanvasListGroupedContent)
// for a uniform feel across panels — same row/hover/selected treatment and
// sidebar-* color tokens, same @xyne/icons chevrons/folder/file glyphs. The
// chevron, icon, and label all live inside this one rounded box (not a
// separate unstyled chevron beside a separately-rounded label), so hover and
// the active/selected fill cover the whole row as a single pill, exactly
// like CanvasListGroupedContent's folder row.
// px-3/gap-3 (not px-2/gap-2) matters beyond visual match: the guide rail's
// `ml-[18px]` below is derived from this exact padding (12px + half the
// 12px chevron glyph = 18px, centring the rail under the chevron) — using
// Canvas's own px-3 keeps that constant correct instead of silently
// misaligning the rail by the padding difference.
const ROW_CLASS =
  'group flex items-center gap-3 h-9 px-3 rounded-[10px] border border-transparent text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';
const ROW_ACTIVE_CLASS = 'bg-sidebar-accent border-sidebar-border text-sidebar-accent-foreground';

export interface KbContentsFile {
  id: string;
  name: string;
}

interface OutlineNode {
  id: string;
  name: string;
  children: OutlineNode[];
}

// Folders only — mirrors a Wikipedia Contents box, which outlines headings
// (sections) rather than body text. Files render as leaves under each
// folder (see `filesByFolder`) once that folder is expanded.
function buildOutline(ids: string[], nodes: Record<string, CollectionTreeNode>): OutlineNode[] {
  return ids
    .map(id => nodes[id])
    .filter((n): n is CollectionTreeNode => n !== undefined && n.type === 'FOLDER')
    .map(n => ({
      id: n.id,
      name: n.name,
      children: buildOutline(n.childrenIds, nodes),
    }));
}

// True if this folder's own name matches, any of its direct files match, or
// anything further down its subtree does — used to decide whether a branch
// survives filtering at all when searching.
function outlineNodeMatches(
  node: OutlineNode,
  filesByFolder: Map<string, KbContentsFile[]>,
  query: string,
): boolean {
  if (node.name.toLowerCase().includes(query)) return true;
  const files = filesByFolder.get(node.id) ?? [];
  if (files.some(f => f.name.toLowerCase().includes(query))) return true;
  return node.children.some(child => outlineNodeMatches(child, filesByFolder, query));
}

function filterOutline(
  list: OutlineNode[],
  filesByFolder: Map<string, KbContentsFile[]>,
  query: string,
): OutlineNode[] {
  return list
    .filter(n => outlineNodeMatches(n, filesByFolder, query))
    .map(n => ({ ...n, children: filterOutline(n.children, filesByFolder, query) }));
}

interface OutlineRowProps {
  label: string;
  isActive: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onClick: () => void;
  highlightQuery?: string | undefined;
}

// No per-row indentation here — depth comes entirely from GuideRail wrapping
// (below), same as CanvasListGroupedContent's folder rows: children sit
// behind a vertical guide rail rather than an ever-larger flat padding, so
// nested levels read as a connected tree instead of just shifting right.
const OutlineRow: React.FC<OutlineRowProps> = ({
  label,
  isActive,
  hasChildren,
  isExpanded,
  onToggleExpand,
  onClick,
  highlightQuery,
}) => (
  // The row itself owns the navigate click — not just the label button next
  // to it — so the gap-3 space between the chevron/icon and the label (and
  // the icon itself) is clickable too, instead of a dead zone in the middle
  // of a row that visually hovers as one piece. The chevron stays its own
  // nested button and stops propagation so it can still toggle independently
  // without also firing a navigate.
  <div
    role='button'
    tabIndex={0}
    onClick={onClick}
    onKeyDown={e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    }}
    data-track-category='knowledge-base'
    data-track-name='kb-contents-navigate'
    className={cn(ROW_CLASS, isActive && ROW_ACTIVE_CLASS)}
  >
    {hasChildren ? (
      <button
        type='button'
        onClick={e => {
          e.stopPropagation();
          onToggleExpand();
        }}
        aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
        data-track-category='knowledge-base'
        data-track-name='kb-contents-toggle-section'
        className='flex shrink-0 items-center gap-2'
      >
        {isExpanded ? (
          <ChevronBigDown size={12} className='shrink-0' />
        ) : (
          <ChevronBigRight size={12} className='shrink-0' />
        )}
        <FolderDefault size={16} className='shrink-0' />
      </button>
    ) : (
      <span className='flex shrink-0 items-center'>
        <FolderDefault size={16} className='shrink-0' />
      </span>
    )}
    <span className='min-w-0 flex-1 truncate text-left text-sm font-medium tracking-[-0.14px]'>
      <HighlightedText text={label} query={highlightQuery} />
    </span>
  </div>
);

const FileLeafRow: React.FC<{
  label: string;
  isActive: boolean;
  onClick: () => void;
  highlightQuery?: string | undefined;
}> = ({ label, isActive, onClick, highlightQuery }) => (
  <button
    type='button'
    onClick={onClick}
    data-track-category='knowledge-base'
    data-track-name='kb-contents-open-file'
    className={cn(ROW_CLASS, 'w-full text-left', isActive && ROW_ACTIVE_CLASS)}
  >
    {/* Mirrors a folder row's chevron slot exactly — same wrapper
        (`flex items-center gap-2`), same 12px reserved width standing in
        for the chevron glyph — so the file icon lands at the identical
        offset a folder's icon does at the same depth, not just "close".
        Deriving this from the row's own gap value instead (a file row has
        no separate nested slot, so the icon would sit directly after the
        spacer under the row's outer gap) breaks the moment that gap value
        changes, which is exactly what silently misaligned this before. */}
    <span className='flex shrink-0 items-center gap-2'>
      <span className='w-3 shrink-0' aria-hidden='true' />
      <FileText size={16} className='shrink-0' />
    </span>
    <Tooltip content={label} side='top' align='start' className='max-w-xs break-words'>
      <span className='block min-w-0 flex-1 truncate text-sm font-medium tracking-[-0.14px]'>
        <HighlightedText text={label} query={highlightQuery} />
      </span>
    </Tooltip>
  </button>
);

// Indents a folder's children by the same amount whether or not a line is
// drawn. `showLine` is only true for the files sitting directly inside a
// folder — the last level before content, matching a Wikipedia TOC's
// headings-then-page shape. Turning it on for every folder-to-folder level
// too (KB nests folders arbitrarily deep, unlike Canvas's single-level
// folders) stacks a rail per level and reads as visual noise well before
// you reach any actual files. The 18px offset centres the rail on the
// parent row's chevron (12px glyph + the row's own gap-2 to the icon).
// `border-sidebar-border` (semi-transparent, not a flat light-mode gray)
// over the generic `border-border` token — the latter is tuned for subtle
// card-on-card dividers and reads as nearly invisible against this panel's
// background; the alpha-based sidebar token stays visible on both a light
// and a dark backdrop, matching the border the active-row highlight below
// already uses.
const GuideRail: React.FC<{ children: React.ReactNode; showLine: boolean }> = ({
  children,
  showLine,
}) => (
  <div className={cn('ml-[18px] pl-3', showLine && 'border-l border-sidebar-border')}>
    {children}
  </div>
);

interface TreeState {
  activeFolderId: string | null;
  activeFileId: string | null;
  activePath: Set<string>;
  filesByFolder: Map<string, KbContentsFile[]>;
  // Explicit open/closed overrides, keyed by folder id — lifted to the top
  // of the panel (not per-row local state) so a folder's expanded state
  // survives its parent collapsing and re-expanding. Local state would
  // unmount every descendant on collapse (they're not rendered) and lose
  // it; Canvas avoids exactly this by keeping one flat `collapsedFolders`
  // Set in its top-level list component instead of per-row state.
  expandOverrides: Map<string, boolean>;
  // While searching, every filtered-in branch renders fully expanded — the
  // filtering already trimmed the tree to just the matches (and their
  // ancestors), so there's nothing left to hide behind a closed chevron.
  isSearchActive: boolean;
  highlightQuery: string | undefined;
  onToggleExpand: (folderId: string, currentlyExpanded: boolean) => void;
  onNavigate: (folderId: string) => void;
  // `folderId` is the file's actual parent (this folder, in every call site
  // here) — not necessarily whichever folder is currently active. Every
  // folder's files are preloaded, so you can open a file from a folder
  // you're not browsing; using the active folder instead would point the
  // resulting URL at the wrong folder and the viewer would show nothing.
  onOpenFile: (fileId: string, folderId: string | null) => void;
}

const OutlineBranch: React.FC<{ node: OutlineNode; state: TreeState }> = ({ node, state }) => {
  const {
    activeFolderId,
    activeFileId,
    activePath,
    filesByFolder,
    expandOverrides,
    isSearchActive,
    highlightQuery,
    onToggleExpand,
    onNavigate,
    onOpenFile,
  } = state;
  const isActive = activeFolderId === node.id;
  const expanded = isSearchActive
    ? true
    : expandOverrides.has(node.id)
      ? (expandOverrides.get(node.id) as boolean)
      : activePath.has(node.id);
  const files = filesByFolder.get(node.id) ?? [];
  const hasKnownChildren = node.children.length > 0;

  return (
    <>
      <OutlineRow
        label={node.name}
        isActive={isActive}
        hasChildren
        isExpanded={expanded}
        highlightQuery={highlightQuery}
        onToggleExpand={() => onToggleExpand(node.id, expanded)}
        onClick={() => {
          onNavigate(node.id);
          // Not open yet → reveal it. Already open and already the folder
          // you're in → a re-click is a deliberate "close this", matching
          // the chevron. But navigating into a *different* folder that
          // happens to already be expanded in the tree shouldn't collapse
          // it out from under you the moment you arrive.
          if (!expanded || isActive) onToggleExpand(node.id, expanded);
        }}
      />
      {expanded && (hasKnownChildren || files.length > 0) ? (
        // One rail for the whole sibling group (subfolders *and* files
        // together), not two separate ones — splitting them made a root
        // level with both a folder and a file (a common shape) show a line
        // that only started partway down, right above the file, instead of
        // connecting from the top the way the sibling folder above it does.
        <GuideRail showLine={files.length > 0}>
          {node.children.map(child => (
            <OutlineBranch key={child.id} node={child} state={state} />
          ))}
          {files.map(file => (
            <FileLeafRow
              key={file.id}
              label={file.name}
              isActive={activeFileId === file.id}
              onClick={() => onOpenFile(file.id, node.id)}
              highlightQuery={highlightQuery}
            />
          ))}
        </GuideRail>
      ) : null}
    </>
  );
};

export interface KbContentsRootCollection {
  id: string;
  name: string;
}

interface KbContentsPanelProps {
  collectionName: string;
  collectionId: string;
  activeFolderId: string | null;
  activeFileId: string | null;
  nodes: Record<string, CollectionTreeNode>;
  rootChildrenIds: string[];
  filesByFolder: Map<string, KbContentsFile[]>;
  activePath: Set<string>;
  collapsed: boolean;
  onNavigate: (folderId: string | null) => void;
  onOpenFile: (fileId: string, folderId: string | null) => void;
  onToggleCollapsed: () => void;
  /** KB root mode: no single collection is open, so the panel lists every
   *  top-level collection flat (no nesting — a collection's own subfolders
   *  aren't loaded until you're inside it) instead of one collection's
   *  folder tree. When set, `onNavigateCollection` is required and the
   *  single-collection props above (`nodes`/`rootChildrenIds`/etc.) are
   *  ignored. */
  rootCollections?: KbContentsRootCollection[] | undefined;
  onNavigateCollection?: ((collectionId: string) => void) | undefined;
}

export const KbContentsPanel: React.FC<KbContentsPanelProps> = ({
  collectionName,
  collectionId,
  activeFolderId,
  activeFileId,
  nodes,
  rootChildrenIds,
  filesByFolder,
  activePath,
  collapsed,
  onNavigate,
  onOpenFile,
  onToggleCollapsed,
  rootCollections,
  onNavigateCollection,
}) => {
  const outline = useMemo(() => buildOutline(rootChildrenIds, nodes), [rootChildrenIds, nodes]);

  const [searchQuery, setSearchQuery] = useState('');
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearchActive = normalizedQuery.length > 0;

  // Trims both the folder outline and each folder's own file list down to
  // matches (plus, for folders, any ancestor of a match so the result is
  // still reachable) — computed once here so neither `OutlineBranch` nor
  // the root-level render needs to know search exists beyond reading these.
  const filteredOutline = useMemo(
    () => (isSearchActive ? filterOutline(outline, filesByFolder, normalizedQuery) : outline),
    [outline, filesByFolder, isSearchActive, normalizedQuery],
  );
  const filteredFilesByFolder = useMemo(() => {
    if (!isSearchActive) return filesByFolder;
    const next = new Map<string, KbContentsFile[]>();
    for (const [folderId, files] of filesByFolder) {
      const matched = files.filter(f => f.name.toLowerCase().includes(normalizedQuery));
      if (matched.length > 0) next.set(folderId, matched);
    }
    return next;
  }, [filesByFolder, isSearchActive, normalizedQuery]);
  const rootFiles = filteredFilesByFolder.get(collectionId) ?? [];

  const filteredRootCollections = useMemo(() => {
    if (!rootCollections) return undefined;
    if (!isSearchActive) return rootCollections;
    return rootCollections.filter(c => c.name.toLowerCase().includes(normalizedQuery));
  }, [rootCollections, isSearchActive, normalizedQuery]);

  const [expandOverrides, setExpandOverrides] = useState<Map<string, boolean>>(new Map());
  const onToggleExpand = useCallback((folderId: string, currentlyExpanded: boolean): void => {
    setExpandOverrides(prev => {
      const next = new Map(prev);
      next.set(folderId, !currentlyExpanded);
      return next;
    });
  }, []);

  // A manual toggle from an earlier visit shouldn't keep overriding a
  // folder's default forever — e.g. collapsing it once, then navigating
  // away and back later, should reflect "the active folder defaults open"
  // again rather than the stale collapse from last time. Only the folder
  // *newly* becoming active gets its override cleared; everything else you
  // toggled while browsing elsewhere in the tree is left alone.
  const lastActiveFolderIdRef = useRef(activeFolderId);
  useEffect(() => {
    if (activeFolderId === lastActiveFolderIdRef.current) return;
    lastActiveFolderIdRef.current = activeFolderId;
    if (!activeFolderId) return;
    setExpandOverrides(prev => {
      if (!prev.has(activeFolderId)) return prev;
      const next = new Map(prev);
      next.delete(activeFolderId);
      return next;
    });
  }, [activeFolderId]);

  // `activePath` (from the layout) is only ever "the path to wherever you
  // are right now" — it's recomputed fresh on every navigation, so a folder
  // that was open purely by being on *yesterday's* path (not by an explicit
  // toggle) would drop out and read as closed the moment you navigated to a
  // sibling instead, making it look like opening one folder closes another.
  // Accumulating every path the tree has shown into this set instead means
  // a folder that was ever revealed stays open (until the user explicitly
  // collapses it — that's what `expandOverrides` is for) regardless of
  // where you navigate to next, so multiple folders can stay open at once.
  const [autoOpenedIds, setAutoOpenedIds] = useState<Set<string>>(() => new Set(activePath));
  useEffect(() => {
    setAutoOpenedIds(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const id of activePath) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activePath]);

  const treeState: TreeState = {
    activeFolderId,
    activeFileId,
    activePath: autoOpenedIds,
    filesByFolder: filteredFilesByFolder,
    expandOverrides,
    isSearchActive,
    highlightQuery: isSearchActive ? normalizedQuery : undefined,
    onToggleExpand,
    onNavigate,
    onOpenFile,
  };

  if (collapsed) {
    return (
      <div className='flex h-full flex-col items-center bg-background py-3'>
        <Tooltip content='Show contents panel' side='right'>
          <button
            type='button'
            onClick={onToggleCollapsed}
            aria-label='Show contents panel'
            data-track-category='knowledge-base'
            data-track-name='kb-show-contents'
            className='grid size-7 shrink-0 place-items-center rounded-lg border border-transparent text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          >
            <PanelLeftOpenIcon className='size-4' strokeWidth={2.1} />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <nav
      aria-label='Collection contents'
      className='flex h-full flex-col overflow-hidden bg-background'
    >
      <div className='shrink-0 px-2.5 pt-3'>
        <div className='flex items-center justify-between gap-2 px-1.5 py-1'>
          <h2 className='truncate text-base font-bold leading-normal text-sidebar-accent-foreground'>
            Contents
          </h2>
          <Tooltip content='Hide contents panel' side='bottom' delayDuration={300}>
            <button
              type='button'
              onClick={onToggleCollapsed}
              aria-label='Hide contents panel'
              data-track-category='knowledge-base'
              data-track-name='kb-hide-contents'
              className='size-7 flex items-center justify-center rounded-lg border border-transparent text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            >
              <PanelLeftCloseIcon className='size-4' strokeWidth={2.1} />
            </button>
          </Tooltip>
        </div>
        <div className='relative mt-2'>
          <SearchBig
            size={16}
            className='absolute left-3 top-1/2 -translate-y-1/2 text-sidebar-foreground'
          />
          <Input
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search by name'
            className='h-9 pl-9'
            aria-label='Search files and folders by name'
            data-track-category='knowledge-base'
            data-track-name='kb-contents-search'
          />
        </div>
      </div>

      <div className='flex-1 min-h-0 overflow-auto no-scrollbar px-2.5 pt-2 pb-3'>
        <div className='space-y-0.5'>
          {filteredRootCollections ? (
            filteredRootCollections.length > 0 ? (
              filteredRootCollections.map(c => (
                <OutlineRow
                  key={c.id}
                  label={c.name}
                  isActive={false}
                  hasChildren={false}
                  isExpanded={false}
                  onToggleExpand={() => {}}
                  onClick={() => onNavigateCollection?.(c.id)}
                  highlightQuery={treeState.highlightQuery}
                />
              ))
            ) : (
              <p className='px-1.5 py-1 text-[13px] text-sidebar-foreground/60'>
                {isSearchActive
                  ? `No collections match “${searchQuery.trim()}”`
                  : 'No collections yet'}
              </p>
            )
          ) : (
            <>
              {!isSearchActive ? (
                <OutlineRow
                  label={collectionName}
                  isActive={activeFolderId === null}
                  hasChildren={false}
                  isExpanded={false}
                  onToggleExpand={() => {}}
                  onClick={() => onNavigate(null)}
                />
              ) : null}
              {filteredOutline.length > 0 || rootFiles.length > 0 ? (
                <GuideRail showLine={rootFiles.length > 0}>
                  {filteredOutline.map(node => (
                    <OutlineBranch key={node.id} node={node} state={treeState} />
                  ))}
                  {rootFiles.map(file => (
                    <FileLeafRow
                      key={file.id}
                      label={file.name}
                      isActive={activeFileId === file.id}
                      onClick={() => onOpenFile(file.id, null)}
                      highlightQuery={treeState.highlightQuery}
                    />
                  ))}
                </GuideRail>
              ) : isSearchActive ? (
                <p className='px-1.5 py-1 text-[13px] text-sidebar-foreground/60'>
                  No files or folders match &ldquo;{searchQuery.trim()}&rdquo;
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default KbContentsPanel;
