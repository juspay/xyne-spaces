import { useMemo, useState, type ReactElement } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderDefault,
  InformationCircle,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Checkbox } from '@/components/ui/Checkbox/Checkbox';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import type { KbCollectionNode, KbFile, KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import { KbCollectionMeta, KbFileTile, KbFolderTile } from './KnowledgeTiles';
import {
  countFiles,
  describeFile,
  grantCollection,
  grantFile,
  grantsUnder,
  indexGrants,
  revokeCollection,
  revokeFile,
} from './knowledgeTree';

const SELECTED_FILES_HINT =
  'Everything listed here is readable by the agent. Granting a folder grants everything inside it.';

/** Ancestor chain from the root collection down to `id`, inclusive. */
function pathTo(root: KbCollectionNode, id: string): KbCollectionNode[] {
  const walk = (node: KbCollectionNode, trail: KbCollectionNode[]): KbCollectionNode[] | null => {
    const next = [...trail, node];
    if (node.id === id) return next;
    for (const child of node.children ?? []) {
      const hit = walk(child, next);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root, []) ?? [root];
}

interface KnowledgeCollectionBrowserProps {
  root: KbCollectionNode;
  grants: KbSelection[];
  onGrantsChange: (next: KbSelection[]) => void;
  onDone: () => void;
}

export function KnowledgeCollectionBrowser({
  root,
  grants,
  onGrantsChange,
  onDone,
}: KnowledgeCollectionBrowserProps): ReactElement {
  const [path, setPath] = useState<KbCollectionNode[]>([root]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root.id]));

  const { collections: wholeGrants, files: fileGrants } = useMemo(
    () => indexGrants(grants),
    [grants],
  );
  const mine = useMemo(() => grantsUnder(root, grants), [root, grants]);

  const here = path[path.length - 1] ?? root;
  // A grant on any ancestor already covers everything below it, so those rows
  // read as checked but can't be toggled independently.
  const coveredHere = path.some(node => wholeGrants.has(node.id));

  const openFolder = (node: KbCollectionNode): void => {
    setPath(pathTo(root, node.id));
    setExpanded(current => new Set(current).add(node.id));
  };

  const toggleFolder = (node: KbCollectionNode, covered: boolean): void => {
    if (covered) return;
    onGrantsChange(
      wholeGrants.has(node.id) ? revokeCollection(grants, node.id) : grantCollection(grants, node),
    );
  };

  const toggleFile = (parent: KbCollectionNode, file: KbFile, covered: boolean): void => {
    if (covered) return;
    onGrantsChange(
      fileGrants.has(file.id) ? revokeFile(grants, file.id) : grantFile(grants, parent, file),
    );
  };

  const clearMine = (): void => {
    const removable = new Set(mine.map(grant => `${grant.collectionId}:${grant.fileId ?? '*'}`));
    onGrantsChange(
      grants.filter(grant => !removable.has(`${grant.collectionId}:${grant.fileId ?? '*'}`)),
    );
  };

  const chips = mine.map(grant => {
    const key = `${grant.collectionId}:${grant.fileId ?? '*'}`;
    if (!grant.fileId) {
      const node = pathTo(root, grant.collectionId).at(-1);
      return {
        key,
        name: node?.name ?? 'Folder',
        tile: <KbFolderTile size='sm' />,
        onRemove: (): void => onGrantsChange(revokeCollection(grants, grant.collectionId)),
      };
    }
    const parent = pathTo(root, grant.collectionId).at(-1);
    const file = parent?.items?.find(item => item.id === grant.fileId);
    return {
      key,
      name: file?.name ?? 'File',
      tile: <KbFileTile name={file?.name ?? ''} size='sm' />,
      onRemove: (): void => onGrantsChange(revokeFile(grants, grant.fileId as string)),
    };
  });

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden px-[22px] pb-3 pt-2'>
      <div className='flex h-11 shrink-0 items-center gap-2.5'>
        <KbFolderTile size='lg' />
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <span className='truncate text-sm font-semibold leading-[1.3] tracking-[-0.28px] text-foreground'>
            {root.name}
          </span>
          <KbCollectionMeta node={root} />
        </div>
        <button
          type='button'
          onClick={onDone}
          disabled={mine.length === 0}
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: add KB selection'
          className='flex h-7 shrink-0 items-center rounded-[10px] border-[0.8px] border-transparent bg-primary px-2 text-sm font-medium leading-[1.2] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40'
        >
          Add Selected
        </button>
      </div>

      <div className='mt-8 shrink-0 border-t border-border' />

      <div className='mt-4 flex shrink-0 flex-col gap-4'>
        <div className='flex items-center gap-1.5'>
          <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
            Selected Files
          </span>
          <Tooltip side='top' content={SELECTED_FILES_HINT}>
            <span className='inline-flex'>
              <InformationCircle className='size-4 shrink-0 text-muted-foreground' aria-hidden />
            </span>
          </Tooltip>
        </div>

        {chips.length === 0 ? (
          <p className='text-sm leading-5 text-muted-foreground'>No files selected</p>
        ) : (
          <>
            <div className='flex max-h-[88px] flex-wrap gap-2 overflow-y-auto'>
              {chips.map(chip => (
                <button
                  key={chip.key}
                  type='button'
                  onClick={chip.onRemove}
                  title={`Remove ${chip.name}`}
                  aria-label={`Remove ${chip.name}`}
                  data-track-category='Claw Agents'
                  data-track-name='Create agent v2: remove KB grant'
                  className='flex shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-solid border-border bg-muted py-1 pl-1 pr-2 transition-colors hover:bg-muted/70'
                >
                  {chip.tile}
                  <span className='max-w-[200px] truncate text-sm font-medium leading-5 text-foreground'>
                    {chip.name}
                  </span>
                  <MultipleCrossCancelDefault
                    className='size-3 shrink-0 text-muted-foreground'
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            <button
              type='button'
              onClick={clearMine}
              data-track-category='Claw Agents'
              data-track-name='Create agent v2: remove selected KB grants'
              className='self-end text-xs leading-4 tracking-[-0.24px] text-foreground underline underline-offset-2 transition-opacity hover:opacity-70'
            >
              Remove Selected
            </button>
          </>
        )}
      </div>

      <nav aria-label='Folder path' className='mt-8 flex shrink-0 flex-wrap items-center gap-1'>
        {path.map((node, index) => {
          const last = index === path.length - 1;
          return (
            <span key={node.id} className='flex items-center gap-1'>
              {index > 0 && <span className='text-sm text-muted-foreground'>/</span>}
              <button
                type='button'
                disabled={last}
                onClick={() => setPath(path.slice(0, index + 1))}
                data-track-category='Claw Agents'
                data-track-name='Create agent v2: KB breadcrumb'
                className={cn(
                  'max-w-[180px] truncate rounded px-1 text-sm leading-5 transition-colors',
                  last
                    ? 'cursor-default font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {node.name}
              </button>
            </span>
          );
        })}
      </nav>

      <div className='mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden'>
        <div className='w-[250px] shrink-0 overflow-y-auto pr-1'>
          <TreeNode
            node={root}
            covered={false}
            activeId={here.id}
            expanded={expanded}
            onToggleExpanded={id =>
              setExpanded(current => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            grants={grants}
            wholeGrants={wholeGrants}
            fileGrants={fileGrants}
            onOpenFolder={openFolder}
            onToggleFolder={toggleFolder}
            onToggleFile={toggleFile}
          />
        </div>

        <div className='min-w-0 flex-1 overflow-y-auto'>
          <FolderContents
            node={here}
            covered={coveredHere}
            wholeGrants={wholeGrants}
            fileGrants={fileGrants}
            onOpenFolder={openFolder}
            onToggleFolder={toggleFolder}
            onToggleFile={toggleFile}
          />
        </div>
      </div>
    </div>
  );
}

/* ── left pane ─────────────────────────────────────────────────────── */

interface TreeNodeProps {
  node: KbCollectionNode;
  covered: boolean;
  activeId: string;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  grants: KbSelection[];
  wholeGrants: Set<string>;
  fileGrants: Set<string>;
  onOpenFolder: (node: KbCollectionNode) => void;
  onToggleFolder: (node: KbCollectionNode, covered: boolean) => void;
  onToggleFile: (parent: KbCollectionNode, file: KbFile, covered: boolean) => void;
}

function TreeNode({
  node,
  covered,
  activeId,
  expanded,
  onToggleExpanded,
  grants,
  wholeGrants,
  fileGrants,
  onOpenFolder,
  onToggleFolder,
  onToggleFile,
}: TreeNodeProps): ReactElement {
  const children = node.children ?? [];
  const items = node.items ?? [];
  const isOpen = expanded.has(node.id);
  const checked = covered || wholeGrants.has(node.id);
  const partial = !checked && grantsUnder(node, grants).length > 0;

  return (
    <div className='flex flex-col gap-2'>
      <TreeRow
        active={node.id === activeId}
        label={node.name}
        icon={<FolderDefault className='size-4 shrink-0 text-muted-foreground' aria-hidden />}
        checked={checked}
        indeterminate={partial}
        disabled={covered}
        onCheckedChange={() => onToggleFolder(node, covered)}
        onSelect={() => onOpenFolder(node)}
        expandable={children.length > 0 || items.length > 0}
        expanded={isOpen}
        onToggleExpanded={() => onToggleExpanded(node.id)}
        trackName='Create agent v2: open KB folder'
      />

      {isOpen && (children.length > 0 || items.length > 0) && (
        <div className='ml-5 flex flex-col gap-2 border-l border-border pl-2'>
          {children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              covered={checked}
              activeId={activeId}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              grants={grants}
              wholeGrants={wholeGrants}
              fileGrants={fileGrants}
              onOpenFolder={onOpenFolder}
              onToggleFolder={onToggleFolder}
              onToggleFile={onToggleFile}
            />
          ))}
          {items.map(file => (
            <TreeRow
              key={file.id}
              active={false}
              label={file.name}
              checked={checked || fileGrants.has(file.id)}
              indeterminate={false}
              disabled={checked}
              onCheckedChange={() => onToggleFile(node, file, checked)}
              onSelect={() => onToggleFile(node, file, checked)}
              expandable={false}
              expanded={false}
              onToggleExpanded={() => undefined}
              trackName='Create agent v2: toggle KB file'
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeRow({
  active,
  label,
  icon,
  checked,
  indeterminate,
  disabled,
  onCheckedChange,
  onSelect,
  expandable,
  expanded,
  onToggleExpanded,
  trackName,
}: {
  active: boolean;
  label: string;
  icon?: ReactElement;
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onCheckedChange: () => void;
  onSelect: () => void;
  expandable: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  trackName: string;
}): ReactElement {
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div
      className={cn(
        'group flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 transition-colors',
        active ? 'bg-muted' : 'hover:bg-muted/50',
      )}
    >
      {expandable ? (
        <button
          type='button'
          onClick={onToggleExpanded}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: expand KB folder'
          className='flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground'
        >
          <Chevron className='size-3.5' aria-hidden />
        </button>
      ) : (
        <span className='size-4 shrink-0' aria-hidden />
      )}

      {icon}

      <button
        type='button'
        onClick={onSelect}
        title={label}
        data-track-category='Claw Agents'
        data-track-name={trackName}
        className='min-w-0 flex-1 truncate text-left text-sm leading-5 text-foreground'
      >
        {label}
      </button>

      {/* Idle rows stay clean — the box only shows once it carries state or the
          row is hovered. */}
      <span
        className={cn(
          'shrink-0 transition-opacity',
          checked || indeterminate
            ? 'opacity-100'
            : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100',
        )}
      >
        <Checkbox
          checked={checked}
          indeterminate={indeterminate}
          disabled={disabled}
          onChange={onCheckedChange}
          label=''
          size='sm'
        />
      </span>
    </div>
  );
}

/* ── right pane ────────────────────────────────────────────────────── */

function FolderContents({
  node,
  covered,
  wholeGrants,
  fileGrants,
  onOpenFolder,
  onToggleFolder,
  onToggleFile,
}: {
  node: KbCollectionNode;
  covered: boolean;
  wholeGrants: Set<string>;
  fileGrants: Set<string>;
  onOpenFolder: (node: KbCollectionNode) => void;
  onToggleFolder: (node: KbCollectionNode, covered: boolean) => void;
  onToggleFile: (parent: KbCollectionNode, file: KbFile, covered: boolean) => void;
}): ReactElement {
  const children = node.children ?? [];
  const items = node.items ?? [];

  if (children.length === 0 && items.length === 0) {
    return (
      <p className='py-10 text-center text-sm leading-5 text-muted-foreground'>
        This folder is empty.
      </p>
    );
  }

  return (
    <div className='grid grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-2'>
      {children.map(child => {
        const checked = covered || wholeGrants.has(child.id);
        const count = countFiles(child);
        return (
          <ContentCard
            key={child.id}
            tile={<KbFolderTile size='lg' />}
            name={child.name}
            caption={`Folder · ${count} file${count === 1 ? '' : 's'}`}
            checked={checked}
            disabled={covered}
            onToggle={() => onToggleFolder(child, covered)}
            onOpen={() => onOpenFolder(child)}
            trackName='Create agent v2: open KB folder card'
          />
        );
      })}
      {items.map(file => (
        <ContentCard
          key={file.id}
          tile={<KbFileTile name={file.name} size='lg' />}
          name={file.name}
          caption={describeFile(file.name).label}
          checked={covered || fileGrants.has(file.id)}
          disabled={covered}
          onToggle={() => onToggleFile(node, file, covered)}
          trackName='Create agent v2: toggle KB file card'
        />
      ))}
    </div>
  );
}

function ContentCard({
  tile,
  name,
  caption,
  checked,
  disabled,
  onToggle,
  onOpen,
  trackName,
}: {
  tile: ReactElement;
  name: string;
  caption: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** Folders drill in on click; files have nothing below them, so they toggle. */
  onOpen?: () => void;
  trackName: string;
}): ReactElement {
  return (
    <div
      className={cn(
        'group flex h-[60px] items-center gap-1.5 rounded-2xl border-[0.8px] p-2 transition-colors',
        checked ? 'border-border bg-muted/50' : 'border-border bg-card hover:bg-muted/40',
      )}
    >
      {tile}
      <button
        type='button'
        onClick={onOpen ?? onToggle}
        title={name}
        data-track-category='Claw Agents'
        data-track-name={trackName}
        className='flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left'
      >
        <span className='w-full truncate text-sm font-medium leading-5 text-foreground'>
          {name}
        </span>
        <span className='w-full truncate text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
          {caption}
        </span>
      </button>
      <span
        className={cn(
          'shrink-0 transition-opacity',
          checked ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100',
        )}
      >
        <Checkbox checked={checked} disabled={disabled} onChange={onToggle} label='' size='sm' />
      </span>
    </div>
  );
}
