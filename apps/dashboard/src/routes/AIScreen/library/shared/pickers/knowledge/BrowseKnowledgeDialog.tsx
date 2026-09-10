import { useMemo, useState, type ReactElement } from 'react';
import { ChevronRight, MultipleCrossCancelDefault, UserCheck } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { useClawKnowledgeBaseTree } from '@/hooks/useClawKnowledgeBaseTree';
import type { KbCollectionNode, KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import { BrowseDialog, handleBrowseDialogOpenChange } from '../../primitives/BrowseDialog';
import { DetailEmptyState } from '../../primitives/DetailPrimitives';
import { BROWSE_CARD_IDLE, BROWSE_CARD_SELECTED } from '../../primitives/browseCard';
import { KbCollectionMeta, KbFolderTile } from './KnowledgeTiles';
import { KnowledgeCollectionBrowser } from './KnowledgeCollectionBrowser';
import { MatchUserAccessToggle } from './MatchUserAccessToggle';
import type { KbScope } from './knowledgeCatalog';
import { countGrantedFiles, grantsUnder, matchesQuery } from './knowledgeTree';

const USER_SCOPE_NOTE =
  'This agent reads whatever the person running it can already see in Spaces, so there are no collections to pick. Turn this off to attach a fixed set instead.';

interface BrowseKnowledgeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: KbScope;
  onScopeChange: (next: KbScope) => void;
  grants: KbSelection[];
  onGrantsChange: (next: KbSelection[]) => void;
}

export function BrowseKnowledgeDialog({
  open,
  onOpenChange,
  scope,
  onScopeChange,
  grants,
  onGrantsChange,
}: BrowseKnowledgeDialogProps): ReactElement {
  const kb = useClawKnowledgeBaseTree({ enabled: open });
  const tree = useMemo(() => kb.data?.collections ?? [], [kb.data?.collections]);

  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const results = useMemo(() => tree.filter(root => matchesQuery(root, query)), [tree, query]);

  // Chips are keyed by root collection: a grant three folders deep still has to
  // show up (and be removable) against the card the user actually clicked.
  const selected = useMemo(
    () =>
      tree
        .map(root => ({ root, mine: grantsUnder(root, grants) }))
        .filter(entry => entry.mine.length > 0)
        .map(entry => ({
          root: entry.root,
          fileCount: countGrantedFiles(tree, entry.mine),
          keys: new Set(entry.mine.map(grant => `${grant.collectionId}:${grant.fileId ?? '*'}`)),
        })),
    [tree, grants],
  );

  const removeRoot = (keys: Set<string>): void => {
    onGrantsChange(
      grants.filter(grant => !keys.has(`${grant.collectionId}:${grant.fileId ?? '*'}`)),
    );
  };

  const openCollection = openId ? (tree.find(root => root.id === openId) ?? null) : null;
  const noSpacesSession = kb.data?.noSpacesSession ?? false;

  const emptyMessage =
    scope === 'USER'
      ? null
      : noSpacesSession
        ? 'Sign in to Spaces to attach Knowledge Base documents to this agent.'
        : tree.length === 0
          ? "You don't have access to any Knowledge Base collections yet. Create one in Spaces, or ask a teammate to share theirs."
          : results.length === 0
            ? 'No collections match your search.'
            : null;

  return (
    <BrowseDialog
      open={open}
      onOpenChange={next =>
        handleBrowseDialogOpenChange(next, onOpenChange, () => {
          setQuery('');
          setOpenId(null);
        })
      }
      title='Browse Knowledge Base'
      description='Choose what reference material this agent can read.'
      testId='browse-knowledge-dialog'
      query={query}
      onQueryChange={setQuery}
      loading={kb.isLoading}
      isError={kb.isError}
      onRetry={() => void kb.refetch()}
      emptyMessage={emptyMessage}
      {...(openCollection
        ? {
            detail: {
              label: openCollection.name,
              onBack: () => setOpenId(null),
              content: (
                <KnowledgeCollectionBrowser
                  root={openCollection}
                  grants={grants}
                  onGrantsChange={onGrantsChange}
                  onDone={() => setOpenId(null)}
                />
              ),
            },
          }
        : {})}
      toolbar={<MatchUserAccessToggle scope={scope} onScopeChange={onScopeChange} />}
      {...(scope === 'COLLECTIONS' && selected.length > 0
        ? {
            chips: (
              <div className='flex flex-col gap-4 px-2'>
                <div className='flex flex-wrap gap-2'>
                  {selected.map(entry => (
                    <button
                      key={entry.root.id}
                      type='button'
                      onClick={() => removeRoot(entry.keys)}
                      title={`Remove ${entry.root.name}`}
                      aria-label={`Remove ${entry.root.name}`}
                      data-track-category='Claw Agents'
                      data-track-name='Create agent v2: remove KB collection'
                      className='flex shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-solid border-border bg-muted py-1 pl-1 pr-2 transition-colors hover:bg-muted/70'
                    >
                      <KbFolderTile size='sm' />
                      <span className='max-w-[200px] truncate text-sm font-medium leading-5 text-foreground'>
                        {entry.root.name}
                      </span>
                      <span className='shrink-0 text-sm leading-5 text-muted-foreground'>
                        {entry.fileCount} file{entry.fileCount === 1 ? '' : 's'}
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
                  onClick={() => onGrantsChange([])}
                  data-track-category='Claw Agents'
                  data-track-name='Create agent v2: remove all KB grants'
                  className='self-end text-xs leading-4 tracking-[-0.24px] text-foreground underline underline-offset-2 transition-opacity hover:opacity-70'
                >
                  Remove All
                </button>
              </div>
            ),
          }
        : {})}
    >
      {scope === 'USER' ? (
        <div className='flex min-h-0 flex-1 items-center justify-center'>
          <div className='max-w-[380px]'>
            <DetailEmptyState
              icon={<UserCheck className='size-6' aria-hidden />}
              title='Following the running user'
              description={USER_SCOPE_NOTE}
              className='pt-0'
            />
          </div>
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          {results.map(root => (
            <CollectionCard
              key={root.id}
              node={root}
              selected={grantsUnder(root, grants).length > 0}
              onOpen={() => setOpenId(root.id)}
            />
          ))}
        </div>
      )}
    </BrowseDialog>
  );
}

function CollectionCard({
  node,
  selected,
  onOpen,
}: {
  node: KbCollectionNode;
  selected: boolean;
  onOpen: () => void;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onOpen}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: open KB collection'
      className={cn(
        'flex w-full items-center gap-2.5 overflow-hidden rounded-2xl border-[0.8px] border-transparent p-4 text-left transition-colors',
        selected ? BROWSE_CARD_SELECTED : BROWSE_CARD_IDLE,
      )}
    >
      <KbFolderTile size='lg' />
      <span className='flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden'>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='min-w-0 flex-1 truncate text-sm font-medium leading-5 text-foreground'>
            {node.name}
          </span>
          <ChevronRight className='size-4 shrink-0 text-muted-foreground' aria-hidden />
        </span>
        <KbCollectionMeta node={node} />
      </span>
    </button>
  );
}
