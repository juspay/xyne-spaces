import { useState, useEffect, useCallback, useRef, type RefObject, type ReactElement } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  BookOpen,
  MessageSquarePlus,
  Monitor,
  Moon,
  PanelLeftOpen,
  Search,
  Sun,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTheme, type Theme } from '../../hooks/useTheme';
import { useV2SessionsList, useV2SessionInvalidator } from '../../hooks/useAskAISessionsV2';
import { deleteV2Conversation } from '../../services/XyneAI/XyneAISessionsV2Service';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';
import { Popover } from '../ui/Popover';
import type { ConversationHistory as ConversationHistoryType } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { cn } from '../../utils/classNames';
import { formatRelativeTime } from '../../utils/dateUtils';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface AISidebarProps {
  activeSessionId?: string;
  onCreateChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onAccount?: () => void;
  /** External control for mobile drawer */
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function initials(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? '?';
  const b = parts[1]?.[0] ?? '';
  return (a + b).toUpperCase();
}

function useSidebarCollapse(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('ai-sidebar-collapsed') === 'true';
  });

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('ai-sidebar-collapsed', String(next));
      return next;
    });
  }, []);

  // Cmd/Ctrl + \ toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { collapsed, toggle };
}

function useSidebarSearch({ collapsed, expand }: { collapsed: boolean; expand: () => void }): {
  query: string;
  setQuery: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  focusSearch: () => void;
} {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  const focusSearch = useCallback(() => {
    if (collapsed) {
      expand();
      // After expansion animation, focus the input
      setTimeout(() => {
        searchRef.current?.focus();
      }, 350);
    } else {
      searchRef.current?.focus();
    }
  }, [collapsed, expand]);

  return { query, setQuery, searchRef, focusSearch };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Theme Button
// ═══════════════════════════════════════════════════════════════════════════════

function CollapsedThemeButton(): ReactElement {
  const { theme, changeTheme } = useTheme();
  const order: Theme[] = ['classic', 'midnight', 'summer_breeze'];
  const next = order[(order.indexOf(theme) + 1) % order.length] ?? 'classic';
  const Icon = theme === 'classic' ? Sun : theme === 'midnight' ? Moon : Monitor;
  const label = theme === 'classic' ? 'Light' : theme === 'midnight' ? 'Dark' : 'Summer Breeze';

  return (
    <button
      type='button'
      onClick={(): void => changeTheme(next)}
      aria-label={`Theme: ${label}`}
      title={`Theme: ${label}`}
      className='grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground'
      data-track-category='XyneAI'
      data-track-name='TOGGLE_THEME'
    >
      <Icon className='h-4 w-4' aria-hidden strokeWidth={1.75} />
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SidebarNavItem
// ═══════════════════════════════════════════════════════════════════════════════

function SidebarNavItem({
  icon: Icon,
  label,
  collapsed = false,
  active = false,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  collapsed?: boolean;
  active?: boolean;
  onClick?: () => void;
}): ReactElement {
  if (collapsed) {
    return (
      <button
        type='button'
        onClick={onClick}
        aria-label={label}
        title={label}
        className={cn(
          'grid h-9 w-9 place-items-center rounded-lg transition-colors duration-150',
          active
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
        )}
        data-track-category='XyneAI'
        data-track-name='SIDEBAR_NAV'
        data-track-metadata={JSON.stringify({ label })}
      >
        <Icon className='h-4 w-4' aria-hidden strokeWidth={1.75} />
      </button>
    );
  }
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors duration-150',
        active
          ? 'bg-secondary font-medium text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
      data-track-category='XyneAI'
      data-track-name='SIDEBAR_NAV'
      data-track-metadata={JSON.stringify({ label })}
    >
      <Icon className='h-4 w-4 shrink-0' aria-hidden strokeWidth={1.75} />
      <span className='flex-1 truncate text-left'>{label}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SessionHistory (ChatHistory equivalent)
// ═══════════════════════════════════════════════════════════════════════════════

interface SessionHistoryProps {
  sessions: ConversationHistoryType[];
  activeSessionId?: string | undefined;
  query?: string | undefined;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => Promise<void>;
}

function SessionHistory({
  sessions,
  activeSessionId,
  query = '',
  onSelect,
  onDelete,
}: SessionHistoryProps): ReactElement {
  // Rename + star intentionally omitted: claw-auth (the v2 backing store) has
  // no title override or starred field, so those actions can't be implemented
  // here without a schema change. Delete is the only v2 mutation backed by an
  // existing claw-auth endpoint.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const filtered = query.trim()
    ? sessions.filter(s => s.title.toLowerCase().includes(query.trim().toLowerCase()))
    : sessions;

  const handleDelete = async (sessionId: string): Promise<void> => {
    await onDelete(sessionId);
    setDeletingId(null);
  };

  if (filtered.length === 0) {
    return (
      <div className='px-3 pt-10 text-center'>
        <div className='mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-secondary/60'>
          <MessageSquarePlus
            className='h-4 w-4 text-muted-foreground'
            aria-hidden
            strokeWidth={1.5}
          />
        </div>
        {query.trim() ? (
          <p className='text-[12.5px] text-muted-foreground'>
            No matches for <span className='text-foreground'>&quot;{query}&quot;</span>
          </p>
        ) : (
          <>
            <p className='text-[13px] text-foreground'>No sessions yet</p>
            <p className='mt-1 text-[12px] text-muted-foreground'>
              Start a new chat above to see it here.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className='px-2.5 pb-1 pt-3 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80'>
        Recents
      </div>
      <ul className='flex flex-col gap-0.5'>
        {filtered.map(session => {
          const isActive = session.sessionId === activeSessionId;
          const isDeleting = deletingId === session.sessionId;

          if (isDeleting) {
            return (
              <li key={session.sessionId}>
                <div className='flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px]'>
                  <span className='flex-1 truncate'>
                    Delete <span className='text-foreground'>{session.title || 'Untitled'}</span>?
                  </span>
                  <button
                    type='button'
                    onClick={(): void => setDeletingId(null)}
                    className='rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary'
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
                    className='rounded-md bg-destructive px-2 py-0.5 text-[11px] text-destructive-foreground hover:opacity-90'
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
                className={cn(
                  'group relative flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] transition-colors duration-150',
                  isActive
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                {isActive && (
                  <span className='absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary' />
                )}
                <button
                  type='button'
                  onClick={() => onSelect(session.sessionId)}
                  className='flex min-w-0 flex-1 items-center gap-2 text-left'
                  data-track-category='XyneAI'
                  data-track-name='SELECT_SESSION'
                >
                  <span className='min-w-0 flex-1 truncate'>{session.title}</span>
                  <span className='hidden text-[10px] text-muted-foreground/50 group-hover:block shrink-0'>
                    {formatRelativeTime(new Date(session.lastUpdated))}
                  </span>
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
                      className='opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded shrink-0'
                      data-track-category='XyneAI'
                      data-track-name='OPEN_SESSION_MENU'
                    >
                      <MoreVertical
                        className='h-4 w-4 text-muted-foreground'
                        aria-hidden
                        strokeWidth={1.75}
                      />
                    </button>
                  }
                  className='w-48 p-0 bg-popover border border-border rounded-lg shadow-lg'
                >
                  <button
                    type='button'
                    onClick={e => {
                      e.stopPropagation();
                      setOpenDropdownId(null);
                      setDeletingId(session.sessionId);
                    }}
                    className='w-full px-4 py-2 text-left text-sm hover:bg-accent flex items-center gap-2 text-destructive'
                    data-track-category='XyneAI'
                    data-track-name='DELETE_SESSION'
                  >
                    <Trash2 className='h-4 w-4' aria-hidden strokeWidth={1.75} />
                    <span>Delete</span>
                  </button>
                </Popover>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Collapsed Shell
// ═══════════════════════════════════════════════════════════════════════════════

interface CollapsedProps {
  me?: { email: string } | undefined;
  collapsed: boolean;
  onToggle: () => void;
  onCreateChat: () => void;
  onSearchClick: () => void;
  prefixWs: (path: string) => string;
}

function CollapsedShell({
  me,
  collapsed,
  onToggle,
  onCreateChat,
  onSearchClick,
  prefixWs,
}: CollapsedProps): ReactElement {
  const { pathname } = useLocation();
  const onKb = pathname.includes('/knowledge-base') || pathname.includes('/knowledge-base');

  return (
    <div className='flex h-full w-14 flex-col items-center py-3'>
      <button
        type='button'
        onClick={onToggle}
        aria-label='Expand sidebar'
        aria-expanded={!collapsed}
        aria-controls='ai-sidebar'
        title='Expand sidebar  (⌘\\)'
        className='grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground'
        data-track-category='XyneAI'
        data-track-name='EXPAND_SIDEBAR'
      >
        <PanelLeftOpen className='h-4 w-4' aria-hidden strokeWidth={1.75} />
      </button>

      <div className='mt-2 flex flex-col items-center gap-1'>
        <SidebarNavItem
          icon={MessageSquarePlus}
          label='New chat'
          collapsed
          onClick={onCreateChat}
        />
        <SidebarNavItem
          icon={Search}
          label='Search conversations'
          collapsed
          onClick={onSearchClick}
        />
        <Link
          to={prefixWs('/knowledge-base')}
          aria-label='Knowledge'
          title='Knowledge'
          className={cn(
            'grid h-9 w-9 place-items-center rounded-lg transition-colors duration-150',
            onKb
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
        >
          <BookOpen className='h-4 w-4' aria-hidden strokeWidth={1.75} />
        </Link>
      </div>

      <div className='flex-1' />

      <CollapsedThemeButton />
      <button
        type='button'
        aria-label='Account'
        title={me?.email ?? 'Account'}
        className='mt-2 grid h-9 w-9 place-items-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground transition hover:opacity-90'
      >
        {me ? initials(me.email) : '··'}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Expanded Shell
// ═══════════════════════════════════════════════════════════════════════════════

interface ExpandedProps {
  query: string;
  setQuery: (next: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  sessions: ConversationHistoryType[];
  activeSessionId?: string | undefined;
  onCreateChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => Promise<void>;
  prefixWs: (path: string) => string;
}

function ExpandedShell({
  query,
  setQuery,
  searchRef,
  sessions,
  activeSessionId,
  onCreateChat,
  onSelectSession,
  onDeleteSession,
  prefixWs,
}: ExpandedProps): ReactElement {
  const { pathname } = useLocation();
  const onKb = pathname.includes('/knowledge-base') || pathname.includes('/knowledge-base');

  return (
    <div className='flex h-full w-[272px] flex-col'>
      <nav className='flex flex-col gap-0.5 px-2 pt-3'>
        <SidebarNavItem icon={MessageSquarePlus} label='New chat' onClick={onCreateChat} />
        <Link
          to={prefixWs('/knowledge-base')}
          aria-current={onKb ? 'page' : undefined}
          className={cn(
            'group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors duration-150',
            onKb
              ? 'bg-secondary font-medium text-foreground'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
        >
          <BookOpen className='h-4 w-4 shrink-0' aria-hidden strokeWidth={1.75} />
          <span className='flex-1 truncate text-left'>Knowledge</span>
        </Link>
      </nav>

      <div className='px-3 pb-1 pt-2'>
        <div className='relative'>
          <Search
            className='pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground'
            aria-hidden
            strokeWidth={1.75}
          />
          <input
            ref={searchRef}
            type='search'
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder='Search conversations…'
            aria-label='Search conversations'
            className='h-9 w-full rounded-lg bg-secondary px-3 pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40'
            data-track-category='XyneAI'
            data-track-name='SearchSessions'
          />
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-2 pb-2'>
        <SessionHistory
          sessions={sessions}
          activeSessionId={activeSessionId}
          query={query}
          onSelect={onSelectSession}
          onDelete={onDeleteSession}
        />
      </div>
    </div>
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
  const { user } = useAuth();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);

  const { collapsed, toggle } = useSidebarCollapse();

  const { query, setQuery, searchRef, focusSearch } = useSidebarSearch({
    collapsed,
    expand: toggle,
  });

  const { selectedAgentSlug } = useSelectedAgent();
  const effectiveAgentSlug = selectedAgentSlug;
  const { data: sessions = [] } = useV2SessionsList(effectiveAgentSlug, true);
  const { invalidateSessions: invalidateV2Sessions } = useV2SessionInvalidator();

  const handleCreateChat = (): void => {
    onCreateChat();
  };

  const handleSelectSession = (sessionId: string): void => {
    onSelectSession(sessionId);
  };

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

  const me = user?.email ? { email: user.email } : undefined;

  return (
    <aside
      id='ai-sidebar'
      aria-label='AI Sidebar'
      className={cn(
        'h-full flex-shrink-0 overflow-hidden border-r border-border transition-[width] duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)]',
        collapsed ? 'w-14' : 'w-[272px]',
      )}
      style={{ backgroundColor: 'inherit' }}
    >
      {collapsed ? (
        <CollapsedShell
          me={me}
          collapsed={collapsed}
          onToggle={toggle}
          onCreateChat={handleCreateChat}
          onSearchClick={focusSearch}
          prefixWs={prefixWs}
        />
      ) : (
        <ExpandedShell
          query={query}
          setQuery={setQuery}
          searchRef={searchRef}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onCreateChat={handleCreateChat}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          prefixWs={prefixWs}
        />
      )}
    </aside>
  );
}
