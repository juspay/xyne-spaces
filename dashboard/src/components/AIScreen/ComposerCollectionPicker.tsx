import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { BookOpen, ChevronRight, ArrowLeft, Folder, FileText } from 'lucide-react';
import { useQuery as useZeroQuery } from '../../hooks/useQuery';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useSelf } from '../../hooks/useUsers';
import { queries } from '../../zero/queries';
import { cn } from '../../utils/classNames';

interface SelectedCollection {
  id: string;
  name: string;
}
interface FileScope {
  id: string;
  name: string;
}

interface ComposerCollectionPickerProps {
  collections: SelectedCollection[];
  fileScopes: FileScope[];
  onCollectionsChange: (collections: SelectedCollection[]) => void;
  onFileScopesChange: (fileScopes: FileScope[]) => void;
}

/**
 * "Book" button + collection picker for the /ai composer. Multi-select: click
 * collections to toggle them, or double-click to drill into folders and toggle
 * individual files to scope Ask AI to (several files, across folders, stay
 * selected). Agent-scope gating is intentionally omitted here (the backend MCP
 * layer is the hard gate); everything else mirrors the sidebar.
 */
export function ComposerCollectionPicker({
  collections,
  fileScopes,
  onCollectionsChange,
  onFileScopesChange,
}: ComposerCollectionPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const currentUser = useSelf();
  const [zeroCollections] = useZeroQuery(queries.scopedCollections({}), !!currentUser?.id);
  const collectionsList = useMemo(
    () =>
      (zeroCollections ?? []).map(col => ({
        id: col.id,
        name: col.name,
        description: col.description ?? null,
      })),
    [zeroCollections],
  );

  // navStack: [] = collections list; [0] = root collection; deeper = subfolders.
  const [navStack, setNavStack] = useState<Array<{ id: string; name: string }>>([]);
  const inFolderView = navStack.length > 0;
  const rootCollectionId = navStack[0]?.id ?? '';
  const currentFolderId = navStack[navStack.length - 1]?.id ?? '';

  const [allSubfolders] = useCachedQuery(
    queries.collectionSubfolders({ rootCollectionId }),
    inFolderView && !!rootCollectionId,
  );
  const [currentFolderItems] = useCachedQuery(
    queries.collectionItems({ collectionId: currentFolderId }),
    inFolderView && !!currentFolderId,
  );

  const fileQuery = search.trim().toLowerCase();

  const filteredCollections = useMemo(() => {
    if (!fileQuery) return collectionsList;
    return collectionsList.filter(
      c =>
        c.name.toLowerCase().includes(fileQuery) ||
        c.description?.toLowerCase().includes(fileQuery),
    );
  }, [collectionsList, fileQuery]);

  const currentSubfolders = useMemo(() => {
    const all = (allSubfolders ?? [])
      .filter(f => (f as { parentId?: string | null }).parentId === currentFolderId)
      .map(f => ({ id: (f as { id: string }).id, name: (f as { name: string }).name }));
    return !fileQuery ? all : all.filter(f => f.name.toLowerCase().includes(fileQuery));
  }, [allSubfolders, currentFolderId, fileQuery]);

  const currentFiles = useMemo(() => {
    return (currentFolderItems ?? [])
      .map(it => ({
        fileId: (it as { fileId?: string }).fileId ?? '',
        name: (it as { name: string }).name,
      }))
      .filter(it => it.fileId && (!fileQuery || it.name.toLowerCase().includes(fileQuery)));
  }, [currentFolderItems, fileQuery]);

  // Reset navigation + search whenever the picker closes.
  useEffect(() => {
    if (!open) {
      setNavStack([]);
      setSearch('');
    }
  }, [open]);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Disambiguate single-click (select) from double-click (open).
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openNode = useCallback((node: { id: string; name: string }) => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    setSearch('');
    setNavStack(prev => [...prev, node]);
  }, []);

  const handleCollectionSingleClick = useCallback(
    (collection: { id: string; name: string }) => {
      if (clickTimer.current) return; // a double-click is in progress
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        // Toggle this collection in/out of the multi-select set.
        const isSelected = collections.some(c => c.id === collection.id);
        onCollectionsChange(
          isSelected
            ? collections.filter(c => c.id !== collection.id)
            : [...collections, collection],
        );
      }, 220);
    },
    [collections, onCollectionsChange],
  );

  const handleToggleFile = useCallback(
    (file: { fileId: string; name: string }) => {
      // Toggle this file in/out of the multi-select set — keep the picker open
      // so several files (across folders) can be picked in one pass.
      const isSelected = fileScopes.some(f => f.id === file.fileId);
      onFileScopesChange(
        isSelected
          ? fileScopes.filter(f => f.id !== file.fileId)
          : [...fileScopes, { id: file.fileId, name: file.name }],
      );
      // Keep the file's root collection in scope so the backend can resolve it.
      const root = navStack[0];
      if (!isSelected && root && !collections.some(c => c.id === root.id)) {
        onCollectionsChange([...collections, root]);
      }
    },
    [fileScopes, collections, navStack, onFileScopesChange, onCollectionsChange],
  );

  return (
    <div ref={containerRef} className='relative'>
      <button
        type='button'
        onClick={() => setOpen(o => !o)}
        aria-label='Select collections'
        title='Select collections'
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full transition',
          collections.length > 0
            ? 'bg-secondary text-[#7C3AED]'
            : 'text-[#7C3AED] hover:bg-secondary',
        )}
        data-track-category='XyneAI'
        data-track-name='OPEN_COLLECTION_SELECTOR'
      >
        <BookOpen className='h-4 w-4' aria-hidden />
      </button>

      {open && (
        <div className='absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-lg'>
          <div className='border-b border-border bg-muted p-2'>
            {inFolderView && (
              <div className='mb-2 flex items-center gap-1 text-xs text-muted-foreground'>
                <button
                  type='button'
                  onClick={() => {
                    setSearch('');
                    setNavStack(prev => prev.slice(0, -1));
                  }}
                  className='flex items-center hover:text-foreground'
                  aria-label='Back'
                  data-track-category='XyneAI'
                  data-track-name='KB_FOLDER_BACK'
                >
                  <ArrowLeft className='h-3.5 w-3.5' />
                </button>
                <span className='truncate'>{navStack.map(n => n.name).join(' / ')}</span>
              </div>
            )}
            <input
              type='text'
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={inFolderView ? 'Search this folder…' : 'Search collections…'}
              className='w-full rounded-md border border-border bg-popover px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
              data-track-category='XyneAI'
              data-track-name={inFolderView ? 'KB_FOLDER_SEARCH_INPUT' : 'COLLECTION_SEARCH_INPUT'}
            />
          </div>

          <div className='max-h-72 overflow-y-auto'>
            {inFolderView ? (
              currentSubfolders.length === 0 && currentFiles.length === 0 ? (
                <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
                  {search.trim() ? 'No matches' : 'This folder is empty'}
                </div>
              ) : (
                <div className='py-1'>
                  {currentSubfolders.map(folder => (
                    <button
                      key={folder.id}
                      type='button'
                      onDoubleClick={() => openNode(folder)}
                      className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent'
                      title='Double-click to open'
                      data-track-category='XyneAI'
                      data-track-name='OPEN_KB_FOLDER'
                    >
                      <Folder className='h-4 w-4 flex-shrink-0 text-[#7C3AED]' />
                      <span className='flex-1 truncate'>{folder.name}</span>
                      <ChevronRight className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
                    </button>
                  ))}
                  {currentFiles.map(file => {
                    const isSelected = fileScopes.some(f => f.id === file.fileId);
                    return (
                      <button
                        key={file.fileId}
                        type='button'
                        onClick={() => handleToggleFile(file)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                          isSelected && 'bg-accent',
                        )}
                        data-track-category='XyneAI'
                        data-track-name='SELECT_FILE_SCOPE'
                      >
                        <FileText className='h-4 w-4 flex-shrink-0 text-[#7C3AED]' />
                        <span className='flex-1 truncate'>{file.name}</span>
                        {isSelected && <span className='text-xs text-[#7C3AED]'>Selected</span>}
                      </button>
                    );
                  })}
                </div>
              )
            ) : filteredCollections.length === 0 ? (
              <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
                {search.length === 0 ? 'No collections' : 'No collections found'}
              </div>
            ) : (
              <div className='py-1'>
                <div className='px-3 pb-1 text-[11px] text-muted-foreground'>
                  Click to select · double-click to open
                </div>
                {filteredCollections.map(collection => {
                  const isSelected = collections.some(c => c.id === collection.id);
                  return (
                    <button
                      key={collection.id}
                      type='button'
                      onClick={() =>
                        handleCollectionSingleClick({ id: collection.id, name: collection.name })
                      }
                      onDoubleClick={() => openNode({ id: collection.id, name: collection.name })}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                        isSelected && 'bg-accent',
                      )}
                      title='Click to select · double-click to open'
                      data-track-category='XyneAI'
                      data-track-name='SELECT_COLLECTION'
                    >
                      <BookOpen className='h-4 w-4 flex-shrink-0 text-[#7C3AED]' />
                      <span className='flex-1 truncate'>{collection.name}</span>
                      {isSelected && <span className='text-xs text-[#7C3AED]'>Selected</span>}
                      <ChevronRight className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
