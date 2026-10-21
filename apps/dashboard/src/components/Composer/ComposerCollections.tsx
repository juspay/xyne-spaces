import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, BookOpen, Check, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { FolderDefault } from '@xyne/icons';
import { useQuery as useZeroQuery } from '../../hooks/useQuery';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useSelf } from '../../hooks/useUsers';
import { queries } from '../../zero/queries';
import type { AccessibleClawAgent } from '../../services/clawAgentListService';
import { cn } from '../../utils/classNames';
import type {
  ComposerKnowledgeControl,
  KnowledgeScope,
  KnowledgeSelection,
} from './Composer.types';
import {
  MENU_ICON,
  MENU_ROW,
  MENU_SURFACE,
  focusFirstMenuItem,
  usePlusSubmenu,
} from './ComposerControls';

type AgentGrant = NonNullable<AccessibleClawAgent['collections']>[number];

/**
 * The collections an agent can read. A COLLECTIONS-scoped agent lists the
 * roots it has a grant in (whole collection or a file inside); anyone else —
 * Ask AI, Auto, a USER-scoped agent — reads what the user can. claw-auth's MCP
 * layer is the hard gate; this keeps the picker honest about what attaching a
 * collection will get you.
 */
export function collectionsForAgent<T extends { id: string }>(
  collections: T[],
  agent: AccessibleClawAgent | null | undefined,
): T[] {
  if (agent?.kbScope !== 'COLLECTIONS') return collections;
  const roots = new Set((agent.collections ?? []).map(g => g.rootCollectionId));
  return collections.filter(c => roots.has(c.id));
}

/**
 * "Collections ›" in the "+" menu. Opens beside it like Model ›: click a row
 * to attach it (the menu stays open, so several can be picked); double-click,
 * › or → opens
 * a collection or folder to pick inside it, ← goes back. Typing anywhere in
 * it searches.
 */
export function CollectionsSubmenu({
  knowledge,
}: {
  knowledge: ComposerKnowledgeControl;
}): ReactElement {
  const currentUser = useSelf();
  // Subscribed while the "+" menu is open, so the list is there by the time
  // the submenu is.
  const [rows, details] = useZeroQuery(queries.scopedCollections({}), !!currentUser?.id);
  const available = useMemo(
    () =>
      collectionsForAgent(
        (rows ?? []).map(c => ({ id: c.id, name: c.name, description: c.description ?? null })),
        knowledge.agent,
      ),
    [rows, knowledge.agent],
  );
  const loading = details.type !== 'complete' && available.length === 0;
  const count = knowledge.collections.length + knowledge.folders.length + knowledge.files.length;
  const submenu = usePlusSubmenu('collections');

  return (
    <Menu.Sub {...submenu}>
      <Menu.SubTrigger
        className={MENU_ROW}
        data-track-category='XyneAI'
        data-track-name='OPEN_COLLECTION_SELECTOR'
      >
        <BookOpen className={MENU_ICON} aria-hidden strokeWidth={1.75} />
        Collections
        {count > 0 && (
          <span className='ml-auto text-muted-foreground' aria-label={`${count} attached`}>
            {count}
          </span>
        )}
        <ChevronRight
          className={cn('size-4 shrink-0 text-muted-foreground', count === 0 && 'ml-auto')}
          aria-hidden
        />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent
          sideOffset={10}
          alignOffset={-6}
          collisionPadding={12}
          className={cn(MENU_SURFACE, 'flex w-[300px] flex-col')}
        >
          {/* Mounted only while open, so it always opens on the top level. */}
          <CollectionBrowser
            available={available}
            loading={loading}
            knowledge={knowledge}
            grants={
              knowledge.agent?.kbScope === 'COLLECTIONS' ? (knowledge.agent.collections ?? []) : []
            }
          />
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}

const toggle = (list: KnowledgeScope[], item: KnowledgeScope): KnowledgeScope[] =>
  list.some(i => i.id === item.id) ? list.filter(i => i.id !== item.id) : [...list, item];

function CollectionBrowser({
  available,
  loading,
  knowledge,
  grants,
}: {
  available: Array<{ id: string; name: string; description: string | null }>;
  loading: boolean;
  knowledge: ComposerKnowledgeControl;
  grants: AgentGrant[];
}): ReactElement {
  const [query, setQuery] = useState('');
  const [path, setPath] = useState<KnowledgeScope[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Click picks, double-click opens: a row that can open waits a beat before
  // picking, so the second click of a double-click opens it instead.
  const clicksRef = useRef(0);
  const pickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingPick = (): void => {
    if (pickTimerRef.current) clearTimeout(pickTimerRef.current);
    pickTimerRef.current = null;
  };
  useEffect(() => cancelPendingPick, []);
  const inFolder = path.length > 0;
  const rootId = path[0]?.id ?? '';
  const folderId = path.at(-1)?.id ?? '';
  const q = query.trim().toLowerCase();

  const [allSubfolders] = useCachedQuery(
    queries.collectionSubfolders({ rootCollectionId: rootId }),
    inFolder && !!rootId,
  );
  const [folderItems] = useCachedQuery(
    queries.collectionItems({ collectionId: folderId }),
    inFolder && !!folderId,
  );

  // ── What a COLLECTIONS-scoped agent can see inside a collection ──────────
  // A file shows when it has its own grant or a whole-collection grant covers
  // its folder (or any folder above it). A sub-folder shows when such a grant
  // covers it, or some grant lives at or below it — so you can drill to it.
  const rootGrants = useMemo(
    () => grants.filter(g => g.rootCollectionId === rootId),
    [grants, rootId],
  );
  const parentOf = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const f of allSubfolders ?? []) {
      const node = f as { id: string; parentId?: string | null };
      map.set(node.id, node.parentId ?? null);
    }
    return map;
  }, [allSubfolders]);
  const isAncestorOrSelf = useCallback(
    (ancestor: string, id: string): boolean => {
      let cursor: string | null = id;
      while (cursor) {
        if (cursor === ancestor) return true;
        // The root has no entry (the query returns sub-folders only).
        cursor = parentOf.get(cursor) ?? null;
      }
      return false;
    },
    [parentOf],
  );
  const coveredByWholeGrant = useCallback(
    (id: string): boolean =>
      rootGrants.some(g => g.fileId === null && isAncestorOrSelf(g.collectionId, id)),
    [rootGrants, isAncestorOrSelf],
  );
  const gated = rootGrants.length > 0 && !coveredByWholeGrant(folderId);

  const subfolders = useMemo(() => {
    const children = (allSubfolders ?? [])
      .map(f => f as { id: string; name: string; parentId?: string | null })
      .filter(f => f.parentId === folderId && (!q || f.name.toLowerCase().includes(q)))
      .map(f => ({ id: f.id, name: f.name }));
    if (!gated) return children;
    return children.filter(
      f =>
        coveredByWholeGrant(f.id) || rootGrants.some(g => isAncestorOrSelf(f.id, g.collectionId)),
    );
  }, [allSubfolders, folderId, q, gated, coveredByWholeGrant, rootGrants, isAncestorOrSelf]);

  const files = useMemo(() => {
    // A CollectionItem has a row id (what claw-auth grants and attached_context
    // 'file' items carry — stored as the scope id) and a fileId (stable across
    // versions; present only on real files, so it filters out folder rows).
    const all = (folderItems ?? [])
      .map(it => it as { id?: string; fileId?: string; name: string })
      .filter(it => it.id && it.fileId && (!q || it.name.toLowerCase().includes(q)))
      .map(it => ({ id: it.id!, name: it.name }));
    if (!gated) return all;
    const granted = new Set(rootGrants.flatMap(g => (g.fileId ? [g.fileId] : [])));
    return all.filter(f => granted.has(f.id));
  }, [folderItems, q, gated, rootGrants]);

  const collections = useMemo(
    () =>
      available.filter(
        c => !q || c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
      ),
    [available, q],
  );

  // ── Picking ───────────────────────────────────────────────────────────────
  const change = (next: Partial<KnowledgeSelection>): void =>
    knowledge.onChange({
      collections: next.collections ?? knowledge.collections,
      folders: next.folders ?? knowledge.folders,
      files: next.files ?? knowledge.files,
    });
  /** A folder or file is read through its root collection, so picking one keeps the root in. */
  const withRoot = (): KnowledgeScope[] => {
    const root = path[0];
    return root && !knowledge.collections.some(c => c.id === root.id)
      ? [...knowledge.collections, root]
      : knowledge.collections;
  };
  const pickCollection = (item: KnowledgeScope): void =>
    change({ collections: toggle(knowledge.collections, item) });
  const pickFolder = (item: KnowledgeScope): void => {
    const adding = !knowledge.folders.some(f => f.id === item.id);
    change({
      folders: toggle(knowledge.folders, item),
      ...(adding ? { collections: withRoot() } : {}),
    });
  };
  const pickFile = (item: KnowledgeScope): void => {
    const adding = !knowledge.files.some(f => f.id === item.id);
    change({
      files: toggle(knowledge.files, item),
      ...(adding ? { collections: withRoot() } : {}),
    });
  };

  const open = (node: KnowledgeScope): void => {
    cancelPendingPick();
    setQuery('');
    setPath(p => [...p, node]);
  };
  const back = (): void => {
    setQuery('');
    setPath(p => p.slice(0, -1));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target === inputRef.current) return;
    // ← goes up a level before it closes the submenu.
    if (e.key === 'ArrowLeft' && inFolder) {
      e.preventDefault();
      back();
      return;
    }
    // Typing on a row edits the search rather than jumping between rows — the
    // list shrinking under a still pointer can move focus onto a row mid-word.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== ' ') {
      e.preventDefault();
      setQuery(prev => prev + e.key);
      inputRef.current?.focus();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (query) setQuery(prev => prev.slice(0, -1));
      else if (inFolder) back();
      inputRef.current?.focus();
    }
  };

  const row = ({
    item,
    icon,
    selected,
    onPick,
    onOpen,
    trackName,
  }: {
    item: KnowledgeScope;
    icon: ReactElement;
    selected: boolean;
    onPick: () => void;
    onOpen?: () => void;
    trackName: string;
  }): ReactElement => (
    <Menu.Item
      key={item.id}
      // How many clicks this is (0 = Enter/Space), read before onSelect runs.
      onClick={e => {
        clicksRef.current = e.detail;
      }}
      onSelect={e => {
        // Stays open, so several can be picked in one go.
        e.preventDefault();
        const clicks = clicksRef.current;
        clicksRef.current = 0;
        if (!onOpen || clicks === 0) {
          onPick();
          return;
        }
        if (clicks >= 2) {
          onOpen();
          return;
        }
        cancelPendingPick();
        pickTimerRef.current = setTimeout(() => {
          pickTimerRef.current = null;
          onPick();
        }, 220);
      }}
      onKeyDown={e => {
        if (e.key === 'ArrowRight' && onOpen) {
          e.preventDefault();
          e.stopPropagation();
          onOpen();
        }
      }}
      aria-checked={selected}
      role='menuitemcheckbox'
      {...(onOpen ? { title: 'Click to add · double-click to open' } : {})}
      className={cn(MENU_ROW, onOpen && 'pr-1')}
      data-track-category='XyneAI'
      data-track-name={trackName}
      data-track-metadata={JSON.stringify({ id: item.id, selected: !selected })}
    >
      {icon}
      <span className='min-w-0 flex-1 truncate'>{item.name}</span>
      {selected && <Check className='size-4 shrink-0' aria-hidden />}
      {onOpen && (
        <button
          type='button'
          tabIndex={-1}
          aria-label={`Open ${item.name}`}
          title={`Open ${item.name}`}
          onClick={e => {
            // Opening is not picking: keep the click off the row.
            e.preventDefault();
            e.stopPropagation();
            onOpen();
          }}
          className='grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground'
          data-track-category='XyneAI'
          data-track-name='OPEN_KB_FOLDER'
        >
          <ChevronRight className='size-4' aria-hidden />
        </button>
      )}
    </Menu.Item>
  );

  const note = (text: string): ReactElement => (
    <div className='px-2.5 py-3 text-sm text-muted-foreground'>{text}</div>
  );

  let body: ReactElement | ReactElement[];
  if (inFolder) {
    body =
      subfolders.length + files.length === 0
        ? note(q ? 'Nothing here matches' : 'This folder is empty')
        : [
            ...subfolders.map(f =>
              row({
                item: f,
                icon: <FolderDefault className={MENU_ICON} />,
                selected: knowledge.folders.some(s => s.id === f.id),
                onPick: () => pickFolder(f),
                onOpen: () => open(f),
                trackName: 'SELECT_KB_FOLDER',
              }),
            ),
            ...files.map(f =>
              row({
                item: f,
                icon: <FileText className={MENU_ICON} aria-hidden strokeWidth={1.75} />,
                selected: knowledge.files.some(s => s.id === f.id),
                onPick: () => pickFile(f),
                trackName: 'SELECT_FILE_SCOPE',
              }),
            ),
          ];
  } else if (collections.length > 0) {
    body = collections.map(c =>
      row({
        item: { id: c.id, name: c.name },
        icon: <BookOpen className={MENU_ICON} aria-hidden strokeWidth={1.75} />,
        selected: knowledge.collections.some(s => s.id === c.id),
        onPick: () => pickCollection({ id: c.id, name: c.name }),
        onOpen: () => open({ id: c.id, name: c.name }),
        trackName: 'SELECT_COLLECTION',
      }),
    );
  } else if (loading) {
    body = (
      <div className='flex items-center gap-2 px-2.5 py-3 text-sm text-muted-foreground'>
        <Loader2 className='size-4 animate-spin' aria-hidden />
        Loading collections…
      </div>
    );
  } else if (q) {
    body = note('No collections match');
  } else if (knowledge.agent?.kbScope === 'COLLECTIONS') {
    body = note(`${knowledge.agent.name} has no collections to read`);
  } else {
    body = note('No collections yet');
  }

  return (
    <div role='presentation' onKeyDown={onKeyDown} className='flex min-h-0 flex-col'>
      <div className={cn('flex items-center gap-1.5 px-2.5', inFolder && 'pl-1')}>
        {/* Inside a collection, back sits where the search field starts. */}
        {inFolder && (
          <button
            type='button'
            onClick={back}
            aria-label='Back'
            title='Back'
            className='grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            data-track-category='XyneAI'
            data-track-name='KB_FOLDER_BACK'
          >
            <ArrowLeft className='size-4' aria-hidden strokeWidth={1.75} />
          </button>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              focusFirstMenuItem(e.currentTarget);
              return;
            }
            if (e.key === 'Backspace' && !query && inFolder) {
              e.preventDefault();
              back();
              return;
            }
            // The menu's own keys (typeahead, ← closing it) stay out of the field.
            if (e.key !== 'Escape') e.stopPropagation();
          }}
          placeholder={inFolder ? 'Search…' : 'Search collections'}
          aria-label={inFolder ? 'Search this folder' : 'Search collections'}
          className='h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
          data-track-category='XyneAI'
          data-track-name={inFolder ? 'KB_FOLDER_SEARCH_INPUT' : 'COLLECTION_SEARCH_INPUT'}
        />
      </div>
      <div className='max-h-[min(340px,55vh)] overflow-y-auto'>
        {inFolder && (
          <div className='truncate px-2.5 pb-1 pt-1.5 text-sm text-muted-foreground'>
            {path.map(n => n.name).join(' / ')}
          </div>
        )}
        {body}
      </div>
    </div>
  );
}
