import { useState, type ComponentType, type SVGProps, type ReactElement } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  ChatPlus,
  ChevronBigDown,
  DeleteDustbin01,
  GitFork01,
  LayoutGridStackDown,
  Notebook,
  PencilEditBox,
  Piechart01,
  ThreeDotsMenuVertical,
  UserTwo,
} from '@xyne/icons';
import { usePlatform } from '../../hooks/usePlatform';
import { useV2SessionsList, useV2SessionInvalidator } from '../../hooks/useAskAISessionsV2';
import { deleteV2Conversation } from '../../services/XyneAI/XyneAISessionsV2Service';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import { Popover } from '../ui/Popover';
import Tooltip from '../ui/Tooltip';
import AppNavigator from '../AppNavigator/AppNavigator';
import type { ConversationHistory as ConversationHistoryType } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { cn } from '../../utils/classNames';

const NAV_ITEM_CLASS =
  'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent hover:border-sidebar-border';

const NAV_ITEM_IDLE_CLASS = 'text-sidebar-foreground hover:text-sidebar-accent-foreground';

const NAV_ITEM_ACTIVE_CLASS =
  'text-sidebar-accent-foreground bg-sidebar-accent border-sidebar-border';

const LIST_ROW_CLASS =
  'flex items-center gap-3 h-9 group rounded-[10px] px-3 border border-transparent transition-colors';

const LIST_ROW_ACTIVE_CLASS =
  'text-sidebar-accent-foreground font-medium bg-sidebar-accent border-sidebar-border';

const LIST_ROW_IDLE_CLASS =
  'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:border-sidebar-border';

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

interface AINavItem {
  key: string;
  label: string;
  icon: NavIcon;
  to: string;
  /** Temporarily kept out of the sidebar. Drop the flag to show the item. */
  hidden?: boolean | undefined;
}

const NAV_ITEMS: AINavItem[] = [
  { key: 'knowledge', label: 'Knowledge', icon: Notebook as NavIcon, to: '/ai/knowledge' },
  {
    key: 'library',
    label: 'Library',
    icon: LayoutGridStackDown as NavIcon,
    to: '/ai/library',
    hidden: true,
  },
  {
    key: 'digital-twin',
    label: 'Digital twin',
    icon: UserTwo as NavIcon,
    to: '/ai/digital-twin',
    hidden: true,
  },
  {
    key: 'metrics',
    label: 'Metrics',
    icon: Piechart01 as NavIcon,
    to: '/ai/metrics',
    hidden: true,
  },
  {
    key: 'workflow',
    label: 'Workflow',
    icon: GitFork01 as NavIcon,
    to: '/ai/workflow',
    hidden: true,
  },
];

const VISIBLE_NAV_ITEMS = NAV_ITEMS.filter(item => !item.hidden);

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface AISidebarProps {
  activeSessionId?: string | undefined;
  onCreateChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onAccount?: (() => void) | undefined;
  /** External control for mobile drawer */
  mobileOpen?: boolean | undefined;
  onMobileOpenChange?: ((open: boolean) => void) | undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SidebarNavItem
// ═══════════════════════════════════════════════════════════════════════════════

function SidebarNavItem({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: NavIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(NAV_ITEM_CLASS, active ? NAV_ITEM_ACTIVE_CLASS : NAV_ITEM_IDLE_CLASS)}
      data-track-category='XyneAI'
      data-track-name='SIDEBAR_NAV'
      data-track-metadata={JSON.stringify({ label })}
    >
      <span className='flex size-4 shrink-0 items-center justify-center'>
        <Icon className='size-4' aria-hidden />
      </span>
      <span className='block min-w-0 flex-1 truncate text-left'>{label}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SessionHistory (ChatHistory equivalent)
// ═══════════════════════════════════════════════════════════════════════════════

interface SessionHistoryProps {
  sessions: ConversationHistoryType[];
  activeSessionId?: string | undefined;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => Promise<void>;
}

function SessionHistory({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
}: SessionHistoryProps): ReactElement {
  // Rename + star intentionally omitted: claw-auth (the v2 backing store) has
  // no title override or starred field, so those actions can't be implemented
  // here without a schema change. Delete is the only v2 mutation backed by an
  // existing claw-auth endpoint.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const handleDelete = async (sessionId: string): Promise<void> => {
    await onDelete(sessionId);
    setDeletingId(null);
  };

  if (sessions.length === 0) {
    return (
      <div className='px-3 pt-8 text-center'>
        <div className='mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-sidebar-accent'>
          <ChatPlus className='size-4 text-sidebar-foreground' aria-hidden />
        </div>
        <p className='text-sm text-sidebar-accent-foreground'>No chats yet</p>
        <p className='mt-1 text-xs text-sidebar-foreground'>
          Start a new chat above to see it here.
        </p>
      </div>
    );
  }

  return (
    <ul className='flex flex-col'>
      {sessions.map(session => {
        const isActive = session.sessionId === activeSessionId;
        const isDeleting = deletingId === session.sessionId;

        if (isDeleting) {
          return (
            <li key={session.sessionId}>
              <div className='flex h-9 items-center gap-3 rounded-[10px] px-3 text-sm text-sidebar-accent-foreground'>
                <span className='min-w-0 flex-1 truncate'>
                  Delete <span className='font-medium'>{session.title || 'Untitled'}</span>?
                </span>
                <button
                  type='button'
                  onClick={(): void => setDeletingId(null)}
                  className='shrink-0 rounded-md px-2 py-0.5 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  data-track-category='XyneAI'
                  data-track-name='CANCEL_DELETE_SESSION'
                >
                  Cancel
                </button>
                <button
                  type='button'
                  onClick={(): void => {
                    void handleDelete(session.sessionId);
                  }}
                  className='shrink-0 rounded-md bg-destructive px-2 py-0.5 text-xs text-destructive-foreground transition-opacity hover:opacity-90'
                  data-track-category='XyneAI'
                  data-track-name='CONFIRM_DELETE_SESSION'
                >
                  Delete
                </button>
              </div>
            </li>
          );
        }

        return (
          <li key={session.sessionId}>
            <div
              className={cn(LIST_ROW_CLASS, isActive ? LIST_ROW_ACTIVE_CLASS : LIST_ROW_IDLE_CLASS)}
            >
              <button
                type='button'
                onClick={() => onSelect(session.sessionId)}
                className='min-w-0 flex-1 truncate text-left text-sm'
                data-track-category='XyneAI'
                data-track-name='SELECT_SESSION'
              >
                {session.title}
              </button>
              <Popover
                open={openDropdownId === session.sessionId}
                onOpenChange={(open: boolean) => setOpenDropdownId(open ? session.sessionId : null)}
                align='end'
                sideOffset={4}
                trigger={
                  <button
                    type='button'
                    className={cn(
                      'shrink-0 items-center justify-center rounded-md p-1 hover:bg-sidebar-accent',
                      openDropdownId === session.sessionId ? 'flex' : 'hidden group-hover:flex',
                    )}
                    aria-label='Chat options'
                    data-track-category='XyneAI'
                    data-track-name='OPEN_SESSION_MENU'
                  >
                    <ThreeDotsMenuVertical size={14} className='shrink-0' aria-hidden />
                  </button>
                }
                className='w-48 rounded-lg border border-border bg-popover p-0 shadow-lg'
              >
                <button
                  type='button'
                  onClick={e => {
                    e.stopPropagation();
                    setOpenDropdownId(null);
                    setDeletingId(session.sessionId);
                  }}
                  className='flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-destructive hover:bg-accent'
                  data-track-category='XyneAI'
                  data-track-name='DELETE_SESSION'
                >
                  <DeleteDustbin01 size={14} className='shrink-0' aria-hidden />
                  <span>Delete</span>
                </button>
              </Popover>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main AISidebar Export
// ═══════════════════════════════════════════════════════════════════════════════

export function AISidebar({
  activeSessionId,
  onCreateChat,
  onSelectSession,
}: AISidebarProps): ReactElement {
  const { isMobile } = usePlatform();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { pathname } = useLocation();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);

  const [recentsOpen, setRecentsOpen] = useState(true);

  const routedActiveItem = VISIBLE_NAV_ITEMS.find(item => pathname.includes(item.to));
  const isNewChatActive = !routedActiveItem && !activeSessionId;

  const { selectedAgentSlug } = useSelectedAgent();
  const effectiveAgentSlug = selectedAgentSlug;
  const { data: sessions = [] } = useV2SessionsList(effectiveAgentSlug, true);
  const { invalidateSessions: invalidateV2Sessions } = useV2SessionInvalidator();

  const handleDeleteSession = async (sessionId: string): Promise<void> => {
    try {
      await deleteV2Conversation(sessionId, effectiveAgentSlug);
      // If the user just deleted the conversation they're viewing, bounce
      // back to the new-chat landing so the thread pane isn't stuck on a
      // stale session id.
      if (sessionId === activeSessionId) {
        onCreateChat();
      }
    } finally {
      invalidateV2Sessions(effectiveAgentSlug);
    }
  };

  return (
    <div className={cn('flex h-full w-full flex-col', isMobile && 'bg-sidebar')}>
      <div className='h-[52px] w-full shrink-0'>
        <AppNavigator />
      </div>
      <div className='flex min-h-0 flex-1 flex-col gap-3 border-t border-border px-3 pb-12 pt-3 sm:pb-3'>
        <div className='flex shrink-0 items-center px-3 py-1'>
          <h2 className='text-base font-bold leading-7 tracking-[-0.32px] text-sidebar-accent-foreground'>
            Xyne AI
          </h2>
        </div>

        <div className='flex min-h-0 flex-1 flex-col gap-6'>
          <nav className='flex shrink-0 flex-col gap-1'>
            <SidebarNavItem
              icon={ChatPlus as NavIcon}
              label='New Chat'
              active={isNewChatActive}
              onClick={onCreateChat}
            />
            {VISIBLE_NAV_ITEMS.map(({ key, label, icon: Icon, to }) => {
              const isActive = routedActiveItem?.key === key;
              return (
                <Link
                  key={key}
                  to={prefixWs(to)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    NAV_ITEM_CLASS,
                    isActive ? NAV_ITEM_ACTIVE_CLASS : NAV_ITEM_IDLE_CLASS,
                  )}
                >
                  <span className='flex size-4 shrink-0 items-center justify-center'>
                    <Icon className='size-4' aria-hidden />
                  </span>
                  <span className='block min-w-0 flex-1 truncate text-left'>{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className='flex min-h-0 flex-1 flex-col'>
            <div className='group flex h-7 shrink-0 items-center justify-between gap-2 rounded-[10px] px-3'>
              <button
                type='button'
                onClick={() => setRecentsOpen(prev => !prev)}
                aria-expanded={recentsOpen}
                className='flex min-w-0 flex-1 items-center gap-1 text-xs font-medium capitalize tracking-[0.48px] text-sidebar-foreground transition-colors hover:text-sidebar-accent-foreground'
                data-track-category='XyneAI'
                data-track-name='TOGGLE_RECENTS'
              >
                <span className='block truncate text-left'>Recents</span>
                <ChevronBigDown
                  size={12}
                  className={cn(
                    'shrink-0 transition-transform duration-200',
                    !recentsOpen && '-rotate-90',
                  )}
                  aria-hidden
                />
              </button>
              <Tooltip content='New chat' side='top' sideOffset={0} delayDuration={500}>
                <button
                  type='button'
                  onClick={onCreateChat}
                  aria-label='New chat'
                  className='group/child mr-0.5 rounded-md p-1 text-sidebar-foreground opacity-100 transition-opacity duration-300 ease-in-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-hover:opacity-100 md:opacity-0'
                  data-track-category='XyneAI'
                  data-track-name='NEW_CHAT_FROM_RECENTS'
                >
                  <PencilEditBox
                    size={12}
                    className='text-sidebar-foreground transition-colors group-hover/child:text-sidebar-primary'
                    aria-hidden
                  />
                </button>
              </Tooltip>
            </div>

            {recentsOpen && (
              <div className='min-h-0 flex-1 overflow-y-auto no-scrollbar'>
                <SessionHistory
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  onSelect={onSelectSession}
                  onDelete={handleDeleteSession}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
