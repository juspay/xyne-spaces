import { ReactElement, ReactNode, RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import {
  ChevronDown,
  Lock02Close,
  Star,
  Share02 as Share2,
  PencilEdit as Pencil,
  DeleteDustbin01 as Trash2,
} from '@xyne/icons';
import { PanelsTopLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { SavedConfigEntityName, SavedConfigVisibility } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useViewStar, isViewStarred } from '../../../hooks/useViewStar';
import { ShareViewDialog } from '../ShareViewDialog/ShareViewDialog';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { cn } from '../../../utils/classNames';
import { Dialog } from '../../ui/Dialog';
import Avatar from '../../ui/Avatar/Avatar';
import Button from '../../ui/Button';
import CompactActionsMenu from '../../ui/CompactActionsMenu';
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
  userId: string;
  contextId: string;
  createdAt: number;
  visibility?: string;
  isStarred?: boolean;
  values?: readonly ConfigValue[];
  viewAccess?: readonly { id: string }[];
};

// How many views to show before the "Show more" affordance.
const PAGE_SIZE = 6;

const isViewShared = (view: SavedView): boolean =>
  view.visibility === SavedConfigVisibility.PUBLIC || (view.viewAccess ?? []).length > 0;

const matchesQuery = (name: string, query: string): boolean =>
  name.toLowerCase().includes(query.trim().toLowerCase());

interface ViewRowProps {
  label: string;
  isShared: boolean;
  isActive: boolean;
  ownerId?: string | null;
  onOpen: () => void;
  onRename?: () => void;
  editing?: {
    value: string;
    inputRef: RefObject<HTMLInputElement | null>;
    onChange: (value: string) => void;
    onCommit: () => void;
    onCancel: () => void;
  };
  menu?: ReactNode;
}

// A view row is a div[role=button] (NOT a <button>) so the ⋯ menu — itself a button —
// can live inside without nesting buttons. The menu is revealed on hover OR keyboard focus.
function ViewRow({
  label,
  isShared,
  isActive,
  ownerId,
  onOpen,
  onRename,
  editing,
  menu,
}: ViewRowProps): ReactElement {
  const Icon = isShared ? PanelsTopLeft : Lock02Close;

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={e => {
        if (editing) return;
        // Ignore activations originating from the actions menu (its trigger/items).
        if ((e.target as HTMLElement).closest('[data-view-actions]')) return;
        onOpen();
      }}
      onDoubleClick={e => {
        if (editing || !onRename) return;
        if ((e.target as HTMLElement).closest('[data-view-actions]')) return;
        onRename();
      }}
      onKeyDown={e => {
        if (editing) return;
        if ((e.target as HTMLElement).closest('[data-view-actions]')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group/viewrow relative w-full flex items-center gap-2 px-3 py-2 rounded-[10px] cursor-pointer',
        'text-sm tracking-[-0.14px] transition-[background-color,box-shadow,color]',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        isActive
          ? 'bg-sidebar-accent shadow-sm font-semibold text-sidebar-accent-foreground'
          : 'font-medium text-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
      data-track-category='Projects'
      data-track-name='OpenView'
    >
      <Icon className='size-4 shrink-0 text-muted-foreground' aria-hidden='true' />

      {editing ? (
        <input
          ref={editing.inputRef}
          autoFocus
          value={editing.value}
          onChange={e => editing.onChange(e.target.value)}
          onFocus={e => e.currentTarget.select()}
          onBlur={editing.onCommit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              editing.onCommit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              editing.onCancel();
            }
          }}
          placeholder='View name'
          aria-label='View name'
          data-track-category='Projects'
          data-track-name='RenameViewInput'
          className={cn(
            'flex-1 min-w-0 -mx-1.5 -my-[3px] px-1.5 py-0.5 rounded-md text-left font-medium',
            'bg-background text-foreground placeholder:text-muted-foreground outline-none',
            'border border-ring ring-[3px] ring-ring/30 cursor-text',
          )}
        />
      ) : (
        <span className='flex-1 min-w-0 text-left truncate block'>{label}</span>
      )}

      {ownerId && (
        <Avatar userId={ownerId} size='sm' showActiveStatus={false} className='shrink-0' />
      )}

      {menu}
    </div>
  );
}

interface ViewsSidebarSectionProps {
  searchQuery?: string;
}

const ViewsSidebarSection = ({ searchQuery = '' }: ViewsSidebarSectionProps): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const zero = useZero();
  const { user } = useAuth();
  const { toggleStar } = useViewStar();
  const { projectId, boardId } = useParams<{ projectId?: string; boardId?: string }>();

  const [views] = useCachedQuery(queries.savedConfigsByUser({ userId: user?.id ?? '' }), {
    enabled: !!user?.id,
  });
  const [sharedViews] = useCachedQuery(
    queries.savedConfigsSharedWithUser({ userId: user?.id ?? '' }),
    { enabled: !!user?.id },
  );

  const [isViewsExpanded, setIsViewsExpanded] = useState(true);
  const [isStarredExpanded, setIsStarredExpanded] = useState(true);
  const [isSharedExpanded, setIsSharedExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameOpenedFromMenuRef = useRef(false);
  const renameOriginalRef = useRef('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string } | null>(null);

  const query = searchQuery.trim();

  const allViews = useMemo(() => (views ?? []) as readonly SavedView[], [views]);
  const allSharedViews = useMemo(() => {
    // A view can reach a user through more than one grant (a direct USER share
    // AND a CHANNEL share of a channel they're in), so dedupe by view id. Also
    // drop views the user owns — a channel share to a channel the owner is in
    // would otherwise surface their own view under "Shared with me".
    const seen = new Set<string>();
    const out: SavedView[] = [];
    for (const va of sharedViews ?? []) {
      const v = va.view as SavedView | undefined;
      if (!v || v.userId === user?.id || seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
    }
    return out as readonly SavedView[];
  }, [sharedViews, user?.id]);

  const matching = useMemo(
    () => (list: readonly SavedView[]) =>
      query ? list.filter(view => matchesQuery(view.name, query)) : list,
    [query],
  );

  const starredViews = useMemo(
    () => matching(allViews.filter(isViewStarred)),
    [allViews, matching],
  );
  const unstarredViews = useMemo(
    () => matching(allViews.filter(view => !isViewStarred(view))),
    [allViews, matching],
  );
  const visibleSharedViews = useMemo(() => matching(allSharedViews), [allSharedViews, matching]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query]);

  const visibleViews = unstarredViews.slice(0, visibleCount);
  const hiddenCount = unstarredViews.length - visibleViews.length;

  const isOnView = (id: string): boolean => location.pathname.endsWith(`/projects/views/${id}`);
  const isMyTicketsActive =
    !projectId && !boardId && !location.pathname.includes('/projects/views');
  const showMyTickets = !query || matchesQuery('My tickets', query);
  const hasNoMatches =
    !!query &&
    !showMyTickets &&
    starredViews.length === 0 &&
    unstarredViews.length === 0 &&
    visibleSharedViews.length === 0;

  const handleShare = (view: SavedView): void => {
    setShareTarget({ id: view.id, name: view.name });
  };

  const openRename = (view: SavedView): void => {
    renameOriginalRef.current = view.name;
    setRenameTarget({ id: view.id, name: view.name });
    setRenameDraft(view.name);
  };

  const clearRenameTimer = (): void => {
    if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
    renameTimerRef.current = null;
  };

  const persistRename = async (id: string, name: string): Promise<void> => {
    const res = await zero.mutate(
      mutators.savedUserConfiguration.update({ configId: id, name, timestamp: Date.now() }),
    ).server;
    if (res.type === 'error') toast.error(res.error?.message ?? 'Failed to rename view');
    else setRenameTarget(prev => (prev && prev.id === id ? { id, name } : prev));
  };

  const handleRenameChange = (value: string): void => {
    setRenameDraft(value);
    clearRenameTimer();
    const name = value.trim();
    if (!renameTarget || !name || name === renameTarget.name) return;
    const target = renameTarget;
    renameTimerRef.current = setTimeout(() => {
      renameTimerRef.current = null;
      void persistRename(target.id, name);
    }, 600);
  };

  const commitRename = (): void => {
    clearRenameTimer();
    const name = renameDraft.trim();
    if (renameTarget && name && name !== renameTarget.name) {
      void persistRename(renameTarget.id, name);
    }
    setRenameTarget(null);
  };

  const cancelRename = (): void => {
    clearRenameTimer();
    if (renameTarget && renameTarget.name !== renameOriginalRef.current) {
      void persistRename(renameTarget.id, renameOriginalRef.current);
    }
    setRenameTarget(null);
  };

  useEffect(() => clearRenameTimer, []);

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

  // ⋯ actions — absolute so it overlays the avatar slot; revealed on hover or keyboard focus.
  // `data-view-actions` lets the row's handlers skip navigation when the menu is used.
  const ownerMenu = (view: SavedView): ReactElement => (
    <div
      data-view-actions
      className='absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/viewrow:opacity-100 group-focus-within/viewrow:opacity-100'
    >
      <CompactActionsMenu
        contentAlign='end'
        onCloseAutoFocus={e => {
          if (!renameOpenedFromMenuRef.current) return;
          renameOpenedFromMenuRef.current = false;
          e.preventDefault();
          renameInputRef.current?.select();
        }}
        triggerClassName={cn(
          'size-7 p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
          'active:scale-[0.96] transition-[transform,background-color,color]',
        )}
        items={[
          {
            icon: <Pencil className='size-4' />,
            label: 'Rename',
            onSelect: () => {
              renameOpenedFromMenuRef.current = true;
              openRename(view);
            },
            testId: 'view-rename',
          },
          {
            icon: <Share2 className='size-4' />,
            label: 'Share',
            onSelect: () => handleShare(view),
            testId: 'view-share',
          },
          {
            icon: (
              <Star
                className={cn('size-4', isViewStarred(view) && 'fill-current text-yellow-500')}
              />
            ),
            label: isViewStarred(view) ? 'Unstar' : 'Star',
            onSelect: () => toggleStar(view),
            testId: 'view-star',
          },
          {
            icon: <Trash2 className='size-4' />,
            label: 'Delete',
            onSelect: () => setDeleteTarget({ id: view.id, name: view.name }),
            testId: 'view-delete',
          },
        ]}
      />
    </div>
  );

  const ownedRow = (view: SavedView): ReactElement => (
    <ViewRow
      key={view.id}
      label={view.name}
      isShared={isViewShared(view)}
      isActive={isOnView(view.id)}
      onOpen={() => void navigate(`/projects/views/${view.id}`)}
      onRename={() => openRename(view)}
      {...(renameTarget?.id === view.id
        ? {
            editing: {
              value: renameDraft,
              inputRef: renameInputRef,
              onChange: handleRenameChange,
              onCommit: commitRename,
              onCancel: cancelRename,
            },
          }
        : {})}
      menu={ownerMenu(view)}
    />
  );

  return (
    <>
      {/* STARRED — only present once at least one view is starred. */}
      <AnimatePresence initial={false}>
        {starredViews.length > 0 && (
          <motion.div
            key='starred'
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
            className='mb-4'
          >
            <DirectorySectionHeader
              title='Starred'
              isExpanded={isStarredExpanded}
              onToggle={() => setIsStarredExpanded(prev => !prev)}
            />
            {isStarredExpanded && <div className='mt-1'>{starredViews.map(ownedRow)}</div>}
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
            {showMyTickets && (
              <ViewRow
                label='My tickets'
                isShared={false}
                isActive={isMyTicketsActive}
                onOpen={() => void navigate('/projects')}
              />
            )}

            {visibleViews.map(ownedRow)}

            {hasNoMatches && (
              <div className='px-3 py-3 text-[13px] text-muted-foreground text-center'>
                No matching views
              </div>
            )}

            {hiddenCount > 0 && (
              <button
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                className='w-full flex items-center gap-2 px-3 py-1.5 rounded-[10px] transition-colors hover:bg-sidebar-accent group'
                data-track-category='Projects'
                data-track-name='ShowMoreViews'
              >
                <span className='size-4 flex items-center justify-center shrink-0'>
                  <ChevronDown className='size-3 text-muted-foreground' />
                </span>
                <span className='text-[13px] tabular-nums text-muted-foreground'>
                  Show more ({hiddenCount})
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* SHARED WITH ME — views shared with the current user via view_access. */}
      <AnimatePresence initial={false}>
        {visibleSharedViews.length > 0 && (
          <motion.div
            key='shared'
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
            className='mb-4'
          >
            <DirectorySectionHeader
              title='Shared with me'
              isExpanded={isSharedExpanded}
              onToggle={() => setIsSharedExpanded(prev => !prev)}
            />
            {isSharedExpanded && (
              <div className='mt-1'>
                {visibleSharedViews.map(view => (
                  <ViewRow
                    key={view.id}
                    label={view.name}
                    isShared
                    isActive={isOnView(view.id)}
                    ownerId={view.userId}
                    onOpen={() => void navigate(`/projects/views/${view.id}`)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share view dialog */}
      {shareTarget && (
        <ShareViewDialog
          isOpen={!!shareTarget}
          onClose={() => setShareTarget(null)}
          viewId={shareTarget.id}
          viewName={shareTarget.name}
        />
      )}

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
