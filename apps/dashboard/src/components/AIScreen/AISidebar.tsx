import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
  type ReactElement,
} from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  BuildingApartmentTwo,
  ChatPlus,
  ChevronBigDown,
  DeleteDustbin01,
  PencilEdit,
  PinSlant,
  LayoutGridStackDown,
  Notebook,
  Piechart01,
  Settings01,
  ThreeDotsMenuVertical,
  UserShield,
  UserTwo,
  File02Ai,
  SidebarLeftClose,
} from '@xyne/icons';
import { Server, X } from 'lucide-react';
import { usePlatform } from '../../hooks/usePlatform';
import { useClawAdminAccessQuery } from '../../hooks/useClawAdminAccess';
import { useHasResourceAccess } from '../../hooks/usePermissions';
import { useClawOrgManageAccess } from '../../hooks/useClawOrganization';
import { useAuth } from '../../hooks/useAuth';
import { useDailyBriefEnabled } from '../../hooks/useDailyBriefEnabled';
import { toast } from 'sonner';
import {
  useV2SessionsList,
  useV2SessionInvalidator,
  useV2SessionPatcher,
} from '../../hooks/useAskAISessionsV2';
import {
  MANUAL_CHAT_TITLE_MAX_CHARS,
  deleteV2Conversation,
  updateV2Conversation,
} from '../../services/XyneAI/XyneAISessionsV2Service';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import { Popover } from '../ui/Popover';
import { Dialog } from '../ui/Dialog/Dialog';
import { Button } from '../ui/Button';
import AppNavigator from '../AppNavigator/AppNavigator';
import type { ConversationHistory as ConversationHistoryType } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { cn } from '../../utils/classNames';
import { UnpinIcon } from '../../assets/icons/UnpinIcon';
import {
  ConversationAgentFilter,
  ConversationListEnd,
  ConversationRowContent,
  useAgentDirectory,
} from './ConversationAgents';
import { agentIdentity, groupByRecency } from '../Chat/XyneAISidebar/utils/XyneAIUtils';

const NAV_ITEM_CLASS =
  'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent';

const NAV_ITEM_IDLE_CLASS = 'text-sidebar-foreground hover:text-sidebar-accent-foreground';

const NAV_ITEM_ACTIVE_CLASS =
  'text-sidebar-accent-foreground bg-sidebar-accent border-sidebar-border';

const LIST_ROW_CLASS =
  'relative flex items-center min-h-[46px] py-1.5 mt-px group rounded-[10px] px-2.5 border border-transparent transition-colors';

const LIST_ROW_ACTIVE_CLASS =
  'text-sidebar-accent-foreground font-medium bg-sidebar-accent border-sidebar-border';

const LIST_ROW_IDLE_CLASS =
  'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent';

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export interface AINavItem {
  key: string;
  label: string;
  icon: NavIcon;
  to: string;
  /** Prefix for active matching when `to` points at one sub-route of a section. */
  matchPath?: string;
  /** Analytics name; emitted as data-track-* on the nav link when set. */
  trackName?: string;
  adminOnly?: boolean;
  /** Claw admins and SDLC admins. */
  sdlcAdminOnly?: boolean;
  orgManagerOnly?: boolean;
  /** Hidden unless the user has the scheduled morning brief switched on. */
  dailyBriefOnly?: boolean;
}

export const NAV_ITEMS: AINavItem[] = [
  { key: 'knowledge', label: 'Knowledge', icon: Notebook as NavIcon, to: '/ai/knowledge' },
  { key: 'agent-hub', label: 'Agent Hub', icon: LayoutGridStackDown as NavIcon, to: '/ai/library' },
  {
    key: 'environments',
    label: 'Environments',
    icon: Server as NavIcon,
    to: '/ai/environments',
    sdlcAdminOnly: true,
  },
  { key: 'digital-twin', label: 'Digital twin', icon: UserTwo as NavIcon, to: '/ai/digital-twin' },
  {
    key: 'organization',
    label: 'Organization',
    icon: BuildingApartmentTwo as NavIcon,
    to: '/ai/organization',
    orgManagerOnly: true,
  },
  { key: 'metrics', label: 'Metrics', icon: Piechart01 as NavIcon, to: '/ai/metrics' },
  { key: 'settings', label: 'Settings', icon: Settings01 as NavIcon, to: '/ai/settings' },
  { key: 'admin', label: 'Admin', icon: UserShield as NavIcon, to: '/ai/admin', adminOnly: true },
  {
    key: 'daily-brief',
    label: 'Morning Brief',
    icon: File02Ai as NavIcon,
    to: '/ai/daily-brief/today',
    matchPath: '/ai/daily-brief',
    trackName: 'OPEN_DAILY_BRIEF',
    dailyBriefOnly: true,
  },
];

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
  /** Collapses the sidebar. Lives beside the title like the ticket views
   *  sidebar; the matching expand control is in the thread header. */
  onToggleCollapse?: (() => void) | undefined;
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

const MARQUEE_PX_PER_SEC = 35;
const MARQUEE_TRAVEL_FRACTION = 0.8;
const MARQUEE_MIN_OVERFLOW_PX = 8;
const MARQUEE_HOVER_RESERVED_PX = 56;

function SessionTitle({ title }: { title: string }): ReactElement {
  const clipRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const clip = clipRef.current;
    const text = textRef.current;
    if (!clip || !text) return;

    const apply = (): void => {
      // Measure the CLIP, never the text: on hover the text becomes
      // width:max-content, so measuring it would report zero overflow and
      // cancel the very animation being measured for.
      const hoverWidth = Math.max(0, clip.clientWidth - MARQUEE_HOVER_RESERVED_PX);
      const overflow = Math.max(0, text.scrollWidth - hoverWidth);
      const seconds =
        overflow < MARQUEE_MIN_OVERFLOW_PX
          ? 0
          : overflow / MARQUEE_PX_PER_SEC / MARQUEE_TRAVEL_FRACTION;
      text.style.setProperty('--marquee-duration', `${seconds.toFixed(2)}s`);
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(clip);
    return () => observer.disconnect();
  }, [title]);

  return (
    <span ref={clipRef} className='sidebar-title-clip min-w-0 flex-1'>
      <span ref={textRef} className='sidebar-title-text' title={title}>
        {title}
      </span>
    </span>
  );
}

interface SessionHistoryProps {
  sessions: ConversationHistoryType[];
  activeSessionId?: string | undefined;
  onSelect: (session: ConversationHistoryType) => void;
  onDelete: (session: ConversationHistoryType) => Promise<void>;
  onRename: (session: ConversationHistoryType, title: string) => Promise<void>;
  onTogglePin: (session: ConversationHistoryType, pinned: boolean) => Promise<void>;
  showEmpty?: boolean;
}

function SessionHistory({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
  showEmpty = true,
}: SessionHistoryProps): ReactElement | null {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const commitRename = (session: ConversationHistoryType): void => {
    const next = renameDraft.trim();
    setRenamingId(null);
    if (!next || next === session.title) return;
    void onRename(session, next);
  };

  const pendingSession = sessions.find(s => s.id === pendingDeleteId) ?? null;

  /** Ignored while the request is in flight so the dialog can't vanish mid-delete. */
  const closeDeleteDialog = (): void => {
    if (isDeleting) return;
    setPendingDeleteId(null);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingSession) return;
    setIsDeleting(true);
    try {
      await onDelete(pendingSession);
      setPendingDeleteId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  if (sessions.length === 0 && !showEmpty) {
    return null;
  }

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
    <>
      <ul className='flex flex-col'>
        {sessions.map(session => {
          const isActive = session.sessionId === activeSessionId;

          return (
            <li key={session.id}>
              <div
                className={cn(
                  LIST_ROW_CLASS,
                  isActive ? LIST_ROW_ACTIVE_CLASS : LIST_ROW_IDLE_CLASS,
                  openDropdownId === session.id && 'sidebar-title-static',
                )}
              >
                {renamingId === session.id ? (
                  <input
                    autoFocus
                    maxLength={MANUAL_CHAT_TITLE_MAX_CHARS}
                    value={renameDraft}
                    onChange={e => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(session)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename(session);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setRenamingId(null);
                      }
                    }}
                    className='min-w-0 flex-1 self-stretch bg-transparent pr-1 text-sm outline-none'
                    aria-label='Rename chat'
                    data-track-category='XyneAI'
                    data-track-name='RENAME_SESSION_INPUT'
                  />
                ) : (
                  <button
                    type='button'
                    onClick={() => onSelect(session)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center self-stretch pr-1 text-left text-sm transition-[padding] group-hover:pr-14',
                      openDropdownId === session.id && 'pr-14',
                    )}
                    data-track-category='XyneAI'
                    data-track-name='SELECT_SESSION'
                  >
                    <ConversationRowContent
                      conversation={session}
                      title={<SessionTitle title={session.title} />}
                      ringClassName={isActive ? 'ring-sidebar-accent' : 'ring-sidebar'}
                    />
                  </button>
                )}
                <span
                  className={cn(
                    'pointer-events-none absolute right-2 flex items-center gap-1 group-hover:pointer-events-auto group-focus-within:pointer-events-auto',
                    openDropdownId === session.id && 'pointer-events-auto',
                    renamingId === session.id && 'invisible pointer-events-none',
                  )}
                >
                  <button
                    type='button'
                    onClick={e => {
                      e.stopPropagation();
                      void onTogglePin(session, !session.isStarred);
                    }}
                    className={cn(
                      'flex shrink-0 items-center justify-center rounded-md p-1 opacity-0 transition-opacity hover:bg-sidebar-accent focus-visible:opacity-100 group-hover:opacity-100',
                      openDropdownId === session.id && 'opacity-100',
                    )}
                    aria-label={session.isStarred ? 'Unpin chat' : 'Pin chat'}
                    title={session.isStarred ? 'Unpin' : 'Pin'}
                    data-track-category='XyneAI'
                    data-track-name='TOGGLE_PIN_SESSION'
                    data-track-metadata={JSON.stringify({
                      surface: 'page',
                      conversationId: session.sessionId,
                      pinned: !session.isStarred,
                    })}
                  >
                    {session.isStarred ? (
                      <UnpinIcon className='h-3.5 w-3.5 shrink-0' />
                    ) : (
                      <PinSlant size={14} className='shrink-0' aria-hidden />
                    )}
                  </button>
                  <Popover
                    open={openDropdownId === session.id}
                    onOpenChange={(open: boolean) => setOpenDropdownId(open ? session.id : null)}
                    side='right'
                    align='start'
                    sideOffset={4}
                    trigger={
                      <button
                        type='button'
                        className={cn(
                          'flex shrink-0 items-center justify-center rounded-md p-1 opacity-0 transition-opacity hover:bg-sidebar-accent focus-visible:opacity-100 group-hover:opacity-100',
                          openDropdownId === session.id && 'opacity-100',
                        )}
                        aria-label='Chat options'
                        data-track-category='XyneAI'
                        data-track-name='OPEN_SESSION_MENU'
                      >
                        <ThreeDotsMenuVertical size={14} className='shrink-0' aria-hidden />
                      </button>
                    }
                    className='w-48 rounded-lg border border-border bg-popover p-1.5 shadow-lg'
                  >
                    <button
                      type='button'
                      onClick={e => {
                        e.stopPropagation();
                        setOpenDropdownId(null);
                        setRenameDraft(session.title);
                        setRenamingId(session.id);
                      }}
                      className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent'
                      data-track-category='XyneAI'
                      data-track-name='RENAME_SESSION'
                      data-track-metadata={JSON.stringify({
                        surface: 'page',
                        conversationId: session.sessionId,
                      })}
                    >
                      <PencilEdit size={14} className='shrink-0' aria-hidden />
                      <span>Rename</span>
                    </button>
                    <button
                      type='button'
                      onClick={e => {
                        e.stopPropagation();
                        setOpenDropdownId(null);
                        void onTogglePin(session, !session.isStarred);
                      }}
                      className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent'
                      data-track-category='XyneAI'
                      data-track-name='PIN_SESSION'
                      data-track-metadata={JSON.stringify({
                        surface: 'page',
                        conversationId: session.sessionId,
                        pinned: !session.isStarred,
                      })}
                    >
                      {session.isStarred ? (
                        <UnpinIcon className='h-3.5 w-3.5 shrink-0' />
                      ) : (
                        <PinSlant size={14} className='shrink-0' aria-hidden />
                      )}
                      <span>{session.isStarred ? 'Unpin' : 'Pin'}</span>
                    </button>
                    <button
                      type='button'
                      onClick={e => {
                        e.stopPropagation();
                        setOpenDropdownId(null);
                        setPendingDeleteId(session.id);
                      }}
                      className='flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-destructive hover:bg-accent'
                      data-track-category='XyneAI'
                      data-track-name='DELETE_SESSION'
                      data-track-metadata={JSON.stringify({
                        surface: 'page',
                        conversationId: session.sessionId,
                      })}
                    >
                      <DeleteDustbin01 size={14} className='shrink-0' aria-hidden />
                      <span>Delete</span>
                    </button>
                  </Popover>
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {pendingSession && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) closeDeleteDialog();
          }}
          title='Delete chat?'
          description={`Delete the chat "${pendingSession.title || 'Untitled'}"? This can't be undone.`}
          className='max-w-[420px] p-0'
          testId='delete-session-dialog'
        >
          <div>
            <div className='flex items-start justify-between gap-3 px-5 py-4'>
              <h2 className='pr-2 text-base font-semibold leading-tight text-foreground'>
                Delete chat?
              </h2>
              <button
                type='button'
                onClick={closeDeleteDialog}
                className='shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                aria-label='Close'
                data-track-category='XyneAI'
                data-track-name='CLOSE_DELETE_SESSION_DIALOG'
              >
                <X className='size-4' aria-hidden />
              </button>
            </div>
            <p className='px-5 pb-5 text-sm leading-relaxed text-foreground'>
              <span className='font-semibold'>{pendingSession.title || 'Untitled'}</span> will be
              deleted for good. This can&apos;t be undone.
            </p>
            <div className='flex justify-end gap-2 px-5 pb-4'>
              <Button
                variant='outline'
                onClick={closeDeleteDialog}
                disabled={isDeleting}
                data-track-category='XyneAI'
                data-track-name='CANCEL_DELETE_SESSION'
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                trackId='ai_delete_session'
                loading={isDeleting}
                onClick={() => void confirmDelete()}
                data-track-category='XyneAI'
                data-track-name='CONFIRM_DELETE_SESSION'
                data-track-metadata={JSON.stringify({
                  surface: 'page',
                  conversationId: pendingDeleteId,
                })}
              >
                Delete
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main AISidebar Export
// ═══════════════════════════════════════════════════════════════════════════════

export function AISidebar({
  activeSessionId,
  onCreateChat,
  onSelectSession,
  onToggleCollapse,
}: AISidebarProps): ReactElement {
  const { isMobile } = usePlatform();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { pathname } = useLocation();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);

  const [recentsOpen, setRecentsOpen] = useState(true);

  const routedActiveItem = NAV_ITEMS.find(item => pathname.includes(item.matchPath ?? item.to));

  const { user } = useAuth();
  const { isAdmin } = useClawAdminAccessQuery(user?.id);
  const { canManage: canManageOrg } = useClawOrgManageAccess();
  const isSdlcAdmin = useHasResourceAccess('SDLC');
  const { enabled: dailyBriefEnabled } = useDailyBriefEnabled();
  const onDailyBriefRoute = pathname.includes('/ai/daily-brief');
  const visibleNavItems = NAV_ITEMS.filter(
    item =>
      (!item.adminOnly || isAdmin) &&
      (!item.sdlcAdminOnly || isAdmin || isSdlcAdmin) &&
      (!item.orgManagerOnly || canManageOrg) &&
      (!item.dailyBriefOnly || dailyBriefEnabled === true || onDailyBriefRoute),
  );
  const isNewChatActive = !routedActiveItem && !activeSessionId;

  // One history across every agent, newest first, 50 at a time; the filter
  // narrows it to one agent on the server, so it reaches unloaded chats too.
  const { setSelectedAgentSlug } = useSelectedAgent();
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const {
    conversations: sessions,
    agents,
    hasMore,
    isLoadingMore,
    loadMore,
  } = useV2SessionsList({ agentSlug: agentFilter });
  const directory = useAgentDirectory();
  const pinnedSessions = sessions.filter(session => session.isStarred);
  const recentGroups = groupByRecency(sessions.filter(session => !session.isStarred));
  const { invalidateSessions: invalidateV2Sessions } = useV2SessionInvalidator();
  const { patchSession } = useV2SessionPatcher();

  // Every action names the row's own agent: a Spaces thread is listed once per
  // agent and its rename/pin/delete are per agent; for a direct chat the server
  // resolves the conversation whichever agent is named.
  const rowAgentSlug = (session: ConversationHistoryType): string | null =>
    session.agentSlug ?? null;

  const handleSelectSession = (session: ConversationHistoryType): void => {
    // Continue with the agent this chat was last with, so the next message
    // doesn't silently switch it to whichever agent was picked before.
    if (session.agentSlug) {
      setSelectedAgentSlug(session.agentSlug === 'ask-ai' ? null : session.agentSlug);
    }
    onSelectSession(session.sessionId);
  };

  const handleDeleteSession = async (session: ConversationHistoryType): Promise<void> => {
    try {
      await deleteV2Conversation(session.sessionId, rowAgentSlug(session));
      // If the user just deleted the conversation they're viewing, bounce
      // back to the new-chat landing so the thread pane isn't stuck on a
      // stale session id.
      if (session.sessionId === activeSessionId) {
        onCreateChat();
      }
    } finally {
      invalidateV2Sessions();
    }
  };

  const handleRenameSession = async (
    session: ConversationHistoryType,
    title: string,
  ): Promise<void> => {
    const agentSlug = rowAgentSlug(session);
    const rollback = patchSession(session.id, { title, titleGenerated: true });
    try {
      await updateV2Conversation(session.sessionId, { title }, agentSlug);
      invalidateV2Sessions();
    } catch {
      rollback();
      toast.error('Could not rename chat');
    }
  };

  const handleTogglePinSession = async (
    session: ConversationHistoryType,
    pinned: boolean,
  ): Promise<void> => {
    const agentSlug = rowAgentSlug(session);
    const rollback = patchSession(session.id, { isStarred: pinned });
    try {
      await updateV2Conversation(session.sessionId, { pinned }, agentSlug);
      invalidateV2Sessions();
    } catch {
      rollback();
      toast.error(pinned ? 'Could not pin chat' : 'Could not unpin chat');
    }
  };

  return (
    <div className={cn('flex h-full w-full flex-col', isMobile && 'bg-sidebar')}>
      <div className='h-[52px] w-full shrink-0'>
        <AppNavigator />
      </div>
      <div className='flex min-h-0 flex-1 flex-col gap-3 border-t border-sidebar-border-muted px-3 pb-12 pt-3 sm:pb-3'>
        <div className='flex shrink-0 items-center justify-between px-3 py-1'>
          <h2 className='text-base font-bold leading-7 tracking-[-0.32px] text-sidebar-accent-foreground'>
            Xyne AI
          </h2>
          {onToggleCollapse && (
            <button
              type='button'
              onClick={onToggleCollapse}
              aria-label='Collapse sidebar'
              aria-controls='ai-sidebar'
              title='Collapse sidebar'
              className='hidden size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:grid'
              data-track-category='XyneAI'
              data-track-name='TOGGLE_DESKTOP_SIDEBAR'
            >
              <SidebarLeftClose className='size-4' />
            </button>
          )}
        </div>

        <div className='flex min-h-0 flex-1 flex-col gap-6'>
          <nav className='flex shrink-0 flex-col gap-1'>
            <SidebarNavItem
              icon={ChatPlus as NavIcon}
              label='New Chat'
              active={isNewChatActive}
              onClick={onCreateChat}
            />
            {visibleNavItems.map(({ key, label, icon: Icon, to, trackName }) => {
              const isActive = routedActiveItem?.key === key;
              return (
                <Link
                  key={key}
                  to={prefixWs(to)}
                  aria-current={isActive ? 'page' : undefined}
                  {...(trackName
                    ? { 'data-track-category': 'XyneAI', 'data-track-name': trackName }
                    : {})}
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
            {pinnedSessions.length > 0 && (
              <div className='flex max-h-[40%] shrink-0 flex-col'>
                <div className='flex h-7 shrink-0 items-center px-3'>
                  <span className='block truncate text-left text-xs font-medium capitalize tracking-[0.48px] text-sidebar-foreground'>
                    Pinned
                  </span>
                </div>
                <div className='min-h-0 overflow-y-auto no-scrollbar'>
                  <SessionHistory
                    sessions={pinnedSessions}
                    activeSessionId={activeSessionId}
                    onSelect={handleSelectSession}
                    onDelete={handleDeleteSession}
                    onRename={handleRenameSession}
                    onTogglePin={handleTogglePinSession}
                    showEmpty={false}
                  />
                </div>
              </div>
            )}

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
              <ConversationAgentFilter
                options={agents}
                value={agentFilter}
                onChange={setAgentFilter}
              />
            </div>

            {recentsOpen && (
              <div className='min-h-0 flex-1 overflow-y-auto no-scrollbar'>
                {agentFilter && sessions.length === 0 ? (
                  <div className='px-3 pt-6 text-center' data-testid='agent-filter-empty'>
                    <p className='text-sm text-sidebar-accent-foreground'>
                      No chats with {agentIdentity(directory, agentFilter).name}
                    </p>
                    <button
                      type='button'
                      onClick={() => setAgentFilter(null)}
                      data-track-category='XyneAI'
                      data-track-name='CLEAR_AGENT_FILTER_EMPTY'
                      className='mt-1 text-xs font-medium text-sidebar-primary hover:underline'
                    >
                      Show all agents
                    </button>
                  </div>
                ) : recentGroups.length === 0 ? (
                  <SessionHistory
                    sessions={[]}
                    activeSessionId={activeSessionId}
                    onSelect={handleSelectSession}
                    onDelete={handleDeleteSession}
                    onRename={handleRenameSession}
                    onTogglePin={handleTogglePinSession}
                    showEmpty={sessions.length === 0}
                  />
                ) : (
                  recentGroups.map(group => (
                    <section key={group.label} aria-label={group.label}>
                      <h3 className='px-3 pb-0.5 pt-3 text-[11px] font-medium text-muted-foreground first:pt-1'>
                        {group.label}
                      </h3>
                      <SessionHistory
                        sessions={group.conversations}
                        activeSessionId={activeSessionId}
                        onSelect={handleSelectSession}
                        onDelete={handleDeleteSession}
                        onRename={handleRenameSession}
                        onTogglePin={handleTogglePinSession}
                        showEmpty={false}
                      />
                    </section>
                  ))
                )}
                <ConversationListEnd
                  hasMore={hasMore}
                  isLoadingMore={isLoadingMore}
                  onLoadMore={() => void loadMore()}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
