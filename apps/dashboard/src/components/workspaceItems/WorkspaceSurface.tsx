import { MessageSquare, X } from 'lucide-react';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../utils/classNames';
import { ItemView, type ItemViewSlots } from './ItemView';
import { Centered } from './primitives';
import { CommentsPanel } from './CommentsPanel';
import { QuickSwitch, type QuickSwitchProps } from './QuickSwitch';
import { commentStoreFor } from './itemComments';
import { revealAnchor, onCommentsRequested } from './anchorReveal';
import type { WorkspaceItem } from './itemDescriptor';
import type { TabState } from './tabState';

export interface WorkspaceSurfaceProps {
  items: readonly WorkspaceItem[];
  tabs: TabState;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Opens an item that may not be in the strip yet. */
  onOpen?: (id: string) => void;
  sections?: QuickSwitchProps['sections'];
  /** The list or tree of everything available, rendered beside the tabs. */
  explorer?: ReactNode;
  /** Shown when no tab is open. */
  empty?: ReactNode;
  /** Per-item controls for the tab bar's right side. */
  actionsFor?: (item: WorkspaceItem) => ReactNode;
  slots?: ItemViewSlots;
  /**
   * Renders the open item instead of the shared viewer. Returning nothing hands
   * the item back to the shared viewer, so a surface can migrate kind by kind.
   */
  renderItem?: (item: WorkspaceItem) => ReactNode;
  browserBanner?: Parameters<typeof ItemView>[0]['browserBanner'];
  browserOverlay?: Parameters<typeof ItemView>[0]['browserOverlay'];
  icon?: (item: WorkspaceItem) => ReactNode;
  /** A passage the reader picked, offered as the anchor for a new comment. */
  draftAnchor?: { quote: string; selector?: string; line?: number; offset?: number } | null;
}

export function WorkspaceSurface({
  items,
  tabs,
  onActivate,
  onClose,
  onOpen,
  sections,
  explorer,
  empty,
  actionsFor,
  slots,
  renderItem,
  browserBanner,
  browserOverlay,
  icon,
  draftAnchor,
}: WorkspaceSurfaceProps): ReactElement {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);

  useEffect(
    () =>
      onCommentsRequested(request => {
        if (request.itemId !== tabs.activeId) return;
        setCommentsOpen(true);
        setFocusCommentId(request.commentId ?? null);
      }),
    [tabs.activeId],
  );
  const byId = new Map(items.map(item => [item.id, item] as const));
  const open = tabs.openIds.map(id => byId.get(id)).filter((item): item is WorkspaceItem => !!item);
  const active = tabs.activeId ? (byId.get(tabs.activeId) ?? null) : null;
  const own = active ? renderItem?.(active) : null;

  return (
    <div className='flex h-full min-h-0 w-full min-w-0'>
      {explorer ? (
        <div className='flex h-full w-60 min-w-0 flex-shrink-0 flex-col overflow-hidden border-r border-border'>
          {explorer}
        </div>
      ) : null}

      <div className='flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        {open.length > 0 ? (
          <div className='flex h-9 flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-1'>
            <QuickSwitch
              items={items}
              tabs={tabs}
              onOpen={onOpen ?? onActivate}
              {...(icon ? { icon } : {})}
              {...(sections ? { sections } : {})}
            />
            {open.map(item => {
              const isActive = item.id === tabs.activeId;
              return (
                <div
                  key={item.id}
                  className={cn(
                    'group flex h-7 min-w-0 flex-shrink-0 items-center gap-1.5 rounded px-2 text-xs',
                    isActive
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50',
                  )}
                >
                  <button
                    type='button'
                    onClick={() => onActivate(item.id)}
                    className='flex min-w-0 items-center gap-1.5'
                    title={item.title}
                    data-track-category='Workspace'
                    data-track-name='tab-activate'
                  >
                    {icon?.(item)}
                    <span className='max-w-40 truncate'>{item.title}</span>
                  </button>
                  <button
                    type='button'
                    onClick={() => onClose(item.id)}
                    aria-label={`Close ${item.title}`}
                    data-track-category='Workspace'
                    data-track-name='tab-close'
                    className='grid h-4 w-4 flex-shrink-0 place-items-center rounded opacity-0 hover:bg-border group-hover:opacity-100'
                  >
                    <X className='h-3 w-3' />
                  </button>
                </div>
              );
            })}
            {active ? (
              <span className='ml-auto flex flex-shrink-0 items-center gap-1 pr-1'>
                {actionsFor?.(active)}
                {commentStoreFor(active) ? (
                  <button
                    type='button'
                    onClick={() => setCommentsOpen(open => !open)}
                    aria-label={commentsOpen ? 'Hide comments' : 'Show comments'}
                    title={commentsOpen ? 'Hide comments' : 'Show comments'}
                    className={cn(
                      'grid h-7 w-7 place-items-center rounded hover:bg-secondary/60',
                      commentsOpen ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    data-track-category='Workspace'
                    data-track-name='comments-toggle'
                  >
                    <MessageSquare className='h-4 w-4' />
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className='flex min-h-0 w-full min-w-0 flex-1 overflow-hidden'>
          <div className='min-h-0 w-full min-w-0 flex-1 overflow-hidden'>
            {active && own ? (
              <div key={active.id} className='h-full min-h-0 w-full min-w-0'>
                {own}
              </div>
            ) : active ? (
              <ItemView
                key={active.id}
                item={active}
                {...(slots ? { slots } : {})}
                {...(browserBanner ? { browserBanner } : {})}
                {...(browserOverlay ? { browserOverlay } : {})}
              />
            ) : (
              (empty ?? <Centered>Nothing open yet.</Centered>)
            )}
          </div>
          {active && commentsOpen ? (
            <CommentsPanel
              item={active}
              draftAnchor={draftAnchor ?? null}
              focusCommentId={focusCommentId}
              onJump={comment => revealAnchor(active.id, comment.anchor)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
