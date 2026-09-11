import { useState, type ComponentType, type SVGProps, type ReactElement } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  BuildingApartmentTwo,
  ChatPlus,
  ChevronBigDown,
  DeleteDustbin01,
  LayoutGridStackDown,
  Notebook,
  PencilEditBox,
  Piechart01,
  Settings01,
  ThreeDotsMenuVertical,
  UserShield,
  UserTwo,
  File02Ai,
} from '@xyne/icons';
import { X } from 'lucide-react';
import { usePlatform } from '../../hooks/usePlatform';
import { useClawAdminAccessQuery } from '../../hooks/useClawAdminAccess';
import { useClawOrgManageAccess } from '../../hooks/useClawOrganization';
import { useAuth } from '../../hooks/useAuth';
import { useDailyBriefEnabled } from '../../hooks/useDailyBriefEnabled';
import { useV2SessionsList, useV2SessionInvalidator } from '../../hooks/useAskAISessionsV2';
import { deleteV2Conversation } from '../../services/XyneAI/XyneAISessionsV2Service';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import { Popover } from '../ui/Popover';
import { Dialog } from '../ui/Dialog/Dialog';
import { Button } from '../ui/Button';
import Tooltip from '../ui/Tooltip';
import AppNavigator from '../AppNavigator/AppNavigator';
import type { ConversationHistory as ConversationHistoryType } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { cn } from '../../utils/classNames';

const NAV_ITEM_CLASS =
  'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent';

const NAV_ITEM_IDLE_CLASS = 'text-sidebar-foreground hover:text-sidebar-accent-foreground';

const NAV_ITEM_ACTIVE_CLASS =
  'text-sidebar-accent-foreground bg-sidebar-accent border-sidebar-border';

// Side padding lives on the row's children, not the row, so the title button can
// own the full height *and* the left inset — no dead strip around the hit area.
const LIST_ROW_CLASS =
  'flex items-center gap-3 h-9 mt-px group rounded-[10px] px-3 border border-transparent transition-colors';

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
  orgManagerOnly?: boolean;
  /** Hidden unless the user has the scheduled morning brief switched on. */
  dailyBriefOnly?: boolean;
}

export const NAV_ITEMS: AINavItem[] = [
  { key: 'knowledge', label: 'Knowledge', icon: Notebook as NavIcon, to: '/ai/knowledge' },
  { key: 'agent-hub', label: 'Agent Hub', icon: LayoutGridStackDown as NavIcon, to: '/ai/library' },
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const pendingSession = sessions.find(s => s.sessionId === pendingDeleteId) ?? null;

  /** Ignored while the request is in flight so the dialog can't vanish mid-delete. */
  const closeDeleteDialog = (): void => {
    if (isDeleting) return;
    setPendingDeleteId(null);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDeleteId) return;
    setIsDeleting(true);
    try {
      await onDelete(pendingDeleteId);
      setPendingDeleteId(null);
    } finally {
      setIsDeleting(false);
    }
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
    <>
      <ul className='flex flex-col'>
        {sessions.map(session => {
          const isActive = session.sessionId === activeSessionId;

          return (
            <li key={session.sessionId}>
              <div
                className={cn(
                  LIST_ROW_CLASS,
                  isActive ? LIST_ROW_ACTIVE_CLASS : LIST_ROW_IDLE_CLASS,
                )}
              >
                {/* self-stretch overrides the row's items-center, so the button fills
                    the full 36px height instead of just wrapping its line box; pl-3
                    pulls the row's old left inset inside the hit area too. */}
                <button
                  type='button'
                  onClick={() => onSelect(session.sessionId)}
                  className='flex min-w-0 flex-1 items-center self-stretch pl-3 pr-1 text-left text-sm'
                  data-track-category='XyneAI'
                  data-track-name='SELECT_SESSION'
                >
                  <span className='min-w-0 flex-1 truncate'>{session.title}</span>
                </button>
                <Popover
                  open={openDropdownId === session.sessionId}
                  onOpenChange={(open: boolean) =>
                    setOpenDropdownId(open ? session.sessionId : null)
                  }
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
                      setPendingDeleteId(session.sessionId);
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
  const { enabled: dailyBriefEnabled } = useDailyBriefEnabled();
  const onDailyBriefRoute = pathname.includes('/ai/daily-brief');
  const visibleNavItems = NAV_ITEMS.filter(
    item =>
      (!item.adminOnly || isAdmin) &&
      (!item.orgManagerOnly || canManageOrg) &&
      (!item.dailyBriefOnly || dailyBriefEnabled === true || onDailyBriefRoute),
  );
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
      <div className='flex min-h-0 flex-1 flex-col gap-3 border-t border-sidebar-border-muted px-3 pb-12 pt-3 sm:pb-3'>
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
