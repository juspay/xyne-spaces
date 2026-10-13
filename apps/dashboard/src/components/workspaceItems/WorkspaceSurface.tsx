import { MessageSquare } from 'lucide-react';
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
import { useKeptAlive, type KeepAlivePolicy } from '../InAppBrowser/keepAlive';
import { useFirstSeenOrder } from '../InAppBrowser/firstSeenOrder';
import { TabStrip } from '../InAppBrowser/TabStrip';

const notPlaying = (): boolean => false;

export interface WorkspaceSurfaceProps {
  items: readonly WorkspaceItem[];
  tabs: TabState;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** A tab dragged to another's place, at that index. */
  onReorder?: (id: string, toIndex: number) => void;
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
   * `shown` is false for one kept alive out of sight (see `keepAlive`).
   */
  renderItem?: (item: WorkspaceItem, shown: boolean) => ReactNode;
  /**
   * Items whose view stays alive while another tab is open, as a browser keeps its
   * tabs: a web page keeps its place, its sign-in and what was typed in it. Each is
   * drawn by `renderItem`.
   */
  keepAlive?: {
    keeps: (item: WorkspaceItem) => boolean;
    /** The few opened lately, or every one open; see `useKeptAlive`. */
    policy?: KeepAlivePolicy;
    /** Playing a video or a sound: never let go of while it plays. */
    isPlaying?: (itemId: string) => boolean;
  };
  browserBanner?: Parameters<typeof ItemView>[0]['browserBanner'];
  browserOverlay?: Parameters<typeof ItemView>[0]['browserOverlay'];
  icon?: (item: WorkspaceItem) => ReactNode;
  /** A passage the reader picked, offered as the anchor for a new comment. */
  draftAnchor?: { quote: string; selector?: string; line?: number; offset?: number } | null;
  /**
   * On screen. A surface put out of sight keeps its kept-alive items — their pages
   * stay loaded, out of sight — and draws nothing else.
   */
  visible?: boolean;
}

export function WorkspaceSurface({
  items,
  tabs,
  onActivate,
  onClose,
  onReorder,
  onOpen,
  sections,
  explorer,
  empty,
  actionsFor,
  slots,
  renderItem,
  keepAlive,
  browserBanner,
  browserOverlay,
  icon,
  draftAnchor,
  visible = true,
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
  const keeps = (item: WorkspaceItem): boolean => !!renderItem && !!keepAlive?.keeps(item);
  const alive = useKeptAlive(
    open.filter(keeps).map(item => item.id),
    active && keeps(active) ? active.id : null,
    keepAlive?.isPlaying ?? notPlaying,
    keepAlive?.policy,
  );
  // In the order they were opened, not the tabs': a page moved in the document reloads.
  const kept = useFirstSeenOrder(
    open.filter(item => alive.has(item.id)),
    item => item.id,
  );
  const own = visible && active && !alive.has(active.id) ? renderItem?.(active, true) : null;
  // The kept item on screen: the open one, while the surface is.
  const shownId = visible ? (active?.id ?? null) : null;

  return (
    <div className='flex h-full min-h-0 w-full min-w-0'>
      {explorer ? (
        <div className='flex h-full w-60 min-w-0 flex-shrink-0 flex-col overflow-hidden border-r border-border'>
          {explorer}
        </div>
      ) : null}

      <div className='flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        {open.length > 0 ? (
          <div className='flex h-9 flex-shrink-0 items-center gap-1 overflow-hidden border-b border-border px-1'>
            <QuickSwitch
              items={items}
              tabs={tabs}
              onOpen={onOpen ?? onActivate}
              {...(icon ? { icon } : {})}
              {...(sections ? { sections } : {})}
            />
            <TabStrip
              tabs={open.map(item => ({
                key: item.id,
                name: item.title,
                tooltip: item.title,
                icon: icon?.(item) ?? null,
              }))}
              activeKey={tabs.activeId}
              onSelect={onActivate}
              onClose={onClose}
              onReorder={(from, to) => onReorder?.(from, tabs.openIds.indexOf(to))}
              label='Open items'
              trackCategory='Workspace'
              trackNames={{ select: 'tab-activate', close: 'tab-close' }}
            />
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
          <div className='relative min-h-0 w-full min-w-0 flex-1 overflow-hidden'>
            {/* Kept alive: the open one shows; the rest wait out of sight, laid out
                at full size so they don't lay themselves out again when shown. */}
            {kept.map(item => (
              <div
                key={item.id}
                className='absolute inset-0 min-h-0 min-w-0'
                style={item.id === shownId ? undefined : { visibility: 'hidden' }}
              >
                {renderItem?.(item, item.id === shownId)}
              </div>
            ))}
            {!visible || (active && alive.has(active.id)) ? null : active && own ? (
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
          {visible && active && commentsOpen ? (
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
