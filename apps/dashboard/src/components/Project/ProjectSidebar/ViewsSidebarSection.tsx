import { ReactElement, useMemo, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import {
  ChevronDown,
  PlusDefault as Plus,
  Star,
  Share02 as Share2,
  PencilEdit as Pencil,
  DeleteDustbin01 as Trash2,
} from '@xyne/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { SavedConfigEntityName } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useViewStar, isViewStarred } from '../../../hooks/useViewStar';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { buildShareLink } from '../../../utils/savedViewSerialization';
import { cn } from '../../../utils/classNames';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import CompactActionsMenu from '../../ui/CompactActionsMenu';
import SidebarItem from './SidebarItem';
import DirectorySectionHeader from '../../Chat/DirectorySectionHeader';

type ConfigValue = {
  id: string;
  fieldName: string;
  fieldValue: string;
  entityName: SavedConfigEntityName;
};
type SavedView = {
  id: string;
  name: string;
  contextId: string;
  createdAt: number;
  isStarred?: boolean;
  values?: readonly ConfigValue[];
};

// How many views to show before the "Show more" affordance (mirrors the Persons section).
const PAGE_SIZE = 6;

const boardCountOf = (view: SavedView): number =>
  (view.values ?? []).filter(v => v.fieldName === 'boards').length;

interface ViewRowProps {
  view: SavedView;
  isActive: boolean;
  onOpen: () => void;
  onRename: () => void;
  onShare: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
}

// A view row is a div[role=button] (NOT SidebarItem's <button>) so the ⋯ menu — itself a button —
// can live inside without nesting buttons. The menu is revealed on hover OR keyboard focus.
function ViewRow({
  view,
  isActive,
  onOpen,
  onRename,
  onShare,
  onToggleStar,
  onDelete,
}: ViewRowProps): ReactElement {
  const starred = isViewStarred(view);
  const count = boardCountOf(view);

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={e => {
        // Ignore activations originating from the actions menu (its trigger/items).
        if ((e.target as HTMLElement).closest('[data-view-actions]')) return;
        onOpen();
      }}
      onKeyDown={e => {
        if ((e.target as HTMLElement).closest('[data-view-actions]')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group/viewrow relative w-full flex items-center gap-3 px-3 py-2 rounded-[10px] border border-transparent cursor-pointer',
        'text-sm font-medium tracking-[-0.14px] transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        isActive ? 'bg-sidebar-accent' : 'bg-transparent hover:bg-sidebar-accent',
      )}
      data-track-category='Projects'
      data-track-name='OpenView'
    >
      <span
        className={cn(
          'flex-1 min-w-0 text-left truncate block',
          isActive
            ? 'text-sidebar-accent-foreground'
            : 'text-foreground group-hover/viewrow:text-sidebar-accent-foreground',
        )}
      >
        {view.name}
      </span>

      {/* Board count — fades out on hover/focus so it never collides with the ⋯ menu. */}
      {count > 0 && (
        <span className='text-[11px] tabular-nums text-muted-foreground transition-opacity group-hover/viewrow:opacity-0 group-focus-within/viewrow:opacity-0'>
          {count}
        </span>
      )}

      {/* ⋯ actions — absolute so it overlays the count slot; revealed on hover or keyboard focus.
          `data-view-actions` lets the row's handlers skip navigation when the menu is used. */}
      <div
        data-view-actions
        className='absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/viewrow:opacity-100 group-focus-within/viewrow:opacity-100'
      >
        <CompactActionsMenu
          contentAlign='end'
          triggerClassName={cn(
            'size-7 p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
            'active:scale-[0.96] transition-[transform,background-color,color]',
          )}
          items={[
            {
              icon: <Pencil className='size-4' />,
              label: 'Rename',
              onSelect: onRename,
              testId: 'view-rename',
            },
            {
              icon: <Share2 className='size-4' />,
              label: 'Share',
              onSelect: onShare,
              testId: 'view-share',
            },
            {
              icon: <Star className={cn('size-4', starred && 'fill-current text-yellow-500')} />,
              label: starred ? 'Unstar' : 'Star',
              onSelect: onToggleStar,
              testId: 'view-star',
            },
            {
              icon: <Trash2 className='size-4' />,
              label: 'Delete',
              onSelect: onDelete,
              testId: 'view-delete',
            },
          ]}
        />
      </div>
    </div>
  );
}

const ViewsSidebarSection = (): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const zero = useZero();
  const { user } = useAuth();
  const { toggleStar } = useViewStar();
  const { projectId, boardId } = useParams<{ projectId?: string; boardId?: string }>();

  const [views] = useCachedQuery(queries.savedConfigsByUser({ userId: user?.id ?? '' }), {
    enabled: !!user?.id,
  });

  const [isViewsExpanded, setIsViewsExpanded] = useState(true);
  const [isFavoritesExpanded, setIsFavoritesExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const allViews = useMemo(() => (views ?? []) as readonly SavedView[], [views]);

  // Starred-first; Array.sort is stable so each group keeps the query's createdAt-desc order.
  const sortedViews = useMemo(
    () => [...allViews].sort((a, b) => Number(isViewStarred(b)) - Number(isViewStarred(a))),
    [allViews],
  );
  const starredViews = useMemo(() => allViews.filter(isViewStarred), [allViews]);

  const visibleViews = sortedViews.slice(0, visibleCount);
  const hiddenCount = sortedViews.length - visibleViews.length;

  const isOnView = (id: string): boolean => location.pathname.endsWith(`/projects/views/${id}`);
  const isMyTicketsActive =
    !projectId && !boardId && !location.pathname.includes('/projects/views');
  const isCreateActive = location.pathname.endsWith('/projects/views/new');

  const handleShare = (view: SavedView): void => {
    void navigator.clipboard.writeText(buildShareLink(view)).then(
      () => toast.success('Share link copied to clipboard'),
      () => toast.error('Failed to copy link'),
    );
  };

  const openRename = (view: SavedView): void => {
    setRenameTarget({ id: view.id, name: view.name });
    setRenameDraft(view.name);
  };

  const submitRename = async (): Promise<void> => {
    const name = renameDraft.trim();
    if (!name || !renameTarget) return;
    const target = renameTarget;
    setRenameTarget(null);
    const res = await zero.mutate(
      mutators.savedUserConfiguration.update({
        configId: target.id,
        name,
        timestamp: Date.now(),
      }),
    ).server;
    if (res.type === 'error') toast.error(res.error?.message ?? 'Failed to rename view');
    else toast.success('View renamed');
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const wasOpen = isOnView(target.id);
    setDeleteTarget(null);
    const res = await zero.mutate(mutators.savedUserConfiguration.delete({ configId: target.id }))
      .server;
    if (res.type === 'error') {
      toast.error(res.error?.message ?? 'Failed to delete view');
    } else {
      toast.success('View deleted');
      // If we just deleted the view open in the builder, leave the now-dead route.
      if (wasOpen) void navigate('/projects');
    }
  };

  return (
    <>
      {/* FAVORITES — only present once at least one view is starred. */}
      <AnimatePresence initial={false}>
        {starredViews.length > 0 && (
          <motion.div
            key='favorites'
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
            className='mb-4'
          >
            <DirectorySectionHeader
              title='Favorites'
              isExpanded={isFavoritesExpanded}
              onToggle={() => setIsFavoritesExpanded(prev => !prev)}
            />
            {isFavoritesExpanded && (
              <div className='mt-1'>
                {starredViews.map(view => (
                  <SidebarItem
                    key={view.id}
                    label={view.name}
                    isActive={isOnView(view.id)}
                    onClick={() => void navigate(`/projects/views/${view.id}`)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* VIEWS — always present. */}
      <div className='mb-4'>
        <DirectorySectionHeader
          title='Views'
          isExpanded={isViewsExpanded}
          onToggle={() => setIsViewsExpanded(prev => !prev)}
        />
        {isViewsExpanded && (
          <div className='mt-1'>
            <SidebarItem
              label='My Tickets'
              isActive={isMyTicketsActive}
              onClick={() => void navigate('/projects')}
            />

            {visibleViews.map(view => (
              <ViewRow
                key={view.id}
                view={view}
                isActive={isOnView(view.id)}
                onOpen={() => void navigate(`/projects/views/${view.id}`)}
                onRename={() => openRename(view)}
                onShare={() => handleShare(view)}
                onToggleStar={() => toggleStar(view)}
                onDelete={() => setDeleteTarget({ id: view.id, name: view.name })}
              />
            ))}

            {hiddenCount > 0 && (
              <button
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                className='w-full flex items-center gap-2 px-3 py-1.5 rounded-[10px] transition-colors hover:bg-sidebar-accent group'
                data-track-category='Projects'
                data-track-name='ShowMoreViews'
              >
                <ChevronDown className='size-2 text-muted-foreground' />
                <span className='text-[10px] tabular-nums text-muted-foreground'>
                  Show more ({hiddenCount})
                </span>
              </button>
            )}

            <button
              onClick={() => void navigate('/projects/views/new')}
              className={cn(
                'mt-1.5 w-full flex items-center gap-3 px-3 py-2 rounded-[10px] border border-dashed',
                'text-sm font-medium tracking-[-0.14px] transition-[transform,color,border-color,background-color] active:scale-[0.96]',
                isCreateActive
                  ? 'border-border bg-sidebar-accent text-foreground'
                  : 'border-border/70 text-muted-foreground hover:text-sidebar-accent-foreground hover:border-border hover:bg-sidebar-accent',
              )}
              data-track-category='Projects'
              data-track-name='CreateNewView'
            >
              <Plus className='size-4 shrink-0' />
              <span>Create new view</span>
            </button>
          </div>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog
        open={!!renameTarget}
        onOpenChange={open => !open && setRenameTarget(null)}
        title='Rename view'
        description='Choose a clear name for this view.'
        className='max-w-sm rounded-2xl'
      >
        <div className='flex flex-col gap-4 p-5'>
          <div className='flex flex-col gap-1' aria-hidden='true'>
            <h2 className='text-[15px] font-semibold text-foreground text-balance'>Rename view</h2>
            <p className='text-[13px] text-muted-foreground'>Choose a clear name for this view.</p>
          </div>
          <input
            autoFocus
            value={renameDraft}
            onChange={e => setRenameDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void submitRename();
            }}
            placeholder='View name'
            aria-label='View name'
            data-track-category='Projects'
            data-track-name='RenameViewInput'
            className={cn(
              'h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground',
              'outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground',
              'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
            )}
          />
          <div className='flex justify-end gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setRenameTarget(null)}
              data-track-category='Projects'
              data-track-name='CANCEL_RENAME_VIEW'
            >
              Cancel
            </Button>
            <Button
              size='sm'
              onClick={() => void submitRename()}
              data-track-category='Projects'
              data-track-name='CONFIRM_RENAME_VIEW'
              disabled={!renameDraft.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title='Delete view'
        description={deleteTarget ? `${deleteTarget.name} will be permanently removed.` : undefined}
        className='max-w-sm rounded-2xl'
      >
        <div className='flex flex-col gap-5 p-5'>
          <div className='flex items-start gap-3' aria-hidden='true'>
            <div className='flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10'>
              <Trash2 className='size-[18px] text-destructive' />
            </div>
            <div className='flex flex-col gap-1'>
              <h2 className='text-[15px] font-semibold text-foreground'>Delete view</h2>
              <p className='text-[13px] leading-relaxed text-muted-foreground text-pretty'>
                <span className='font-medium text-foreground'>{deleteTarget?.name}</span> will be
                permanently removed. This can’t be undone.
              </p>
            </div>
          </div>
          <div className='flex justify-end gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setDeleteTarget(null)}
              data-track-category='Projects'
              data-track-name='CANCEL_DELETE_VIEW'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              onClick={() => void confirmDelete()}
              data-track-category='Projects'
              data-track-name='CONFIRM_DELETE_VIEW'
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
};

export default ViewsSidebarSection;
