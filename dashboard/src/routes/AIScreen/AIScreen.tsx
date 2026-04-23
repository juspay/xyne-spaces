import { type ReactElement, useState, useEffect, useCallback, useRef } from 'react';
import { History, Pencil, Trash2, X } from 'lucide-react';
import XyneAISidebar from '../../components/Chat/XyneAISidebar/XyneAISidebar';
import { useSessionsList, useSessionMutations } from '../../hooks/useAskAISessions';
import type { ConversationHistory as ConversationHistoryType } from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { cn } from '../../utils/classNames';
import { formatRelativeTime } from '../../utils/dateUtils';

// ─── Date grouping ────────────────────────────────────────────────────────────

function groupByDate(
  conversations: ConversationHistoryType[],
): { label: string; items: ConversationHistoryType[] }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const buckets = new Map<string, ConversationHistoryType[]>();

  for (const conv of conversations) {
    const d = new Date(conv.lastUpdated);
    d.setHours(0, 0, 0, 0);
    let label: string;
    if (d.getTime() === today.getTime()) label = 'Today';
    else if (d.getTime() === yesterday.getTime()) label = 'Yesterday';
    else
      label = d.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
      });
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(conv);
  }

  return [...buckets.entries()].map(([label, items]) => ({ label, items }));
}

// ─── SessionItem ──────────────────────────────────────────────────────────────

interface SessionItemProps {
  conv: ConversationHistoryType;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void | Promise<void>;
  onRename: (newTitle: string) => void | Promise<void>;
}

const SessionItem = ({
  conv,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: SessionItemProps): ReactElement => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setRenameValue(conv.title);
    setIsRenaming(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const commitRename = (): void => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conv.title) void onRename(trimmed);
    setIsRenaming(false);
  };

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={isRenaming ? undefined : onSelect}
      onKeyDown={e => {
        if (!isRenaming && (e.key === 'Enter' || e.key === ' ')) onSelect();
      }}
      data-track-category='AIScreen'
      data-track-name='SELECT_SESSION'
      className={cn(
        'group relative flex items-center gap-1.5 px-3 py-2 rounded-xl cursor-pointer transition-all duration-150 select-none',
        isActive
          ? 'bg-primary/[0.09] text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {/* Active left stripe */}
      {isActive && (
        <span className='absolute left-1 top-2.5 bottom-2.5 w-[2.5px] rounded-full bg-primary' />
      )}

      {isRenaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setIsRenaming(false);
          }}
          onClick={e => e.stopPropagation()}
          data-track-category='AIScreen'
          data-track-name='RENAME_INPUT'
          className='flex-1 min-w-0 text-[12.5px] bg-transparent outline-none border-b border-primary/60 text-foreground pb-px'
        />
      ) : (
        <>
          <span className='flex-1 min-w-0 text-[12.5px] font-normal leading-snug truncate'>
            {conv.title}
          </span>
          <span className='hidden group-hover:block shrink-0 text-[10px] text-muted-foreground/50 mr-0.5'>
            {formatRelativeTime(new Date(conv.lastUpdated))}
          </span>
        </>
      )}

      {/* Hover action buttons */}
      {!isRenaming && (
        <div className='hidden group-hover:flex items-center gap-0.5 shrink-0'>
          <button
            type='button'
            onClick={startRename}
            title='Rename'
            data-track-category='AIScreen'
            data-track-name='RENAME_SESSION'
            className='p-[3px] rounded-md hover:bg-muted text-muted-foreground/60 hover:text-foreground transition-colors'
          >
            <Pencil size={11} />
          </button>
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              void onDelete();
            }}
            title='Delete'
            data-track-category='AIScreen'
            data-track-name='DELETE_SESSION'
            className='p-[3px] rounded-md hover:bg-destructive/10 text-muted-foreground/60 hover:text-destructive transition-colors'
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
};

// ─── History panel (the floating dropdown) ───────────────────────────────────

interface HistoryPanelProps {
  conversations: ConversationHistoryType[];
  activeConversationId: string;
  onSelectSession: (conv: ConversationHistoryType) => void;
  onDeleteSession: (conv: ConversationHistoryType) => void | Promise<void>;
  onRenameSession: (conv: ConversationHistoryType, newTitle: string) => void | Promise<void>;
  onClose: () => void;
}

const HistoryPanel = ({
  conversations,
  activeConversationId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onClose,
}: HistoryPanelProps): ReactElement => {
  const sorted = [...conversations].sort(
    (a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
  );
  const groups = groupByDate(sorted);

  return (
    <div
      className={cn(
        // Position + size
        'absolute top-0 left-0 w-72 z-50',
        // Glass card
        'bg-background/80 backdrop-blur-2xl',
        'border border-border/60',
        'rounded-2xl overflow-hidden',
        // Elevation
        'shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]',
        // Entrance animation
        'animate-in fade-in-0 zoom-in-95 duration-150',
      )}
      style={{ maxHeight: 'min(440px, calc(100vh - 100px))' }}
    >
      {/* Subtle inner highlight rim — visible in light mode */}
      <div className='absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20 pointer-events-none' />

      {/* Header */}
      <div className='flex items-center justify-between px-4 pt-4 pb-3'>
        <div className='flex items-center gap-2'>
          <History size={14} className='text-muted-foreground/60' />
          <span className='text-[13px] font-semibold text-foreground/80 tracking-tight'>
            History
          </span>
        </div>
        <button
          type='button'
          onClick={onClose}
          data-track-category='AIScreen'
          data-track-name='CLOSE_HISTORY_PANEL'
          className={cn(
            'flex items-center justify-center w-6 h-6 rounded-lg',
            'text-muted-foreground/50 hover:text-foreground',
            'hover:bg-muted/60 transition-colors duration-150',
          )}
        >
          <X size={13} />
        </button>
      </div>

      {/* Divider */}
      <div className='mx-3 h-px bg-border/40' />

      {/* Session list */}
      <div
        className='overflow-y-auto scrollbar-none px-2 py-2'
        style={{ maxHeight: 'min(360px, calc(100vh - 160px))' }}
      >
        {conversations.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-10 px-4 gap-2'>
            <History size={24} className='text-muted-foreground/20' />
            <p className='text-[12px] text-muted-foreground/40 text-center leading-relaxed'>
              Your Xyne AI sessions
              <br />
              will appear here
            </p>
          </div>
        ) : (
          groups.map(({ label, items }) => (
            <div key={label} className='mb-1'>
              <p className='px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/40'>
                {label}
              </p>
              {items.map(conv => (
                <SessionItem
                  key={conv.id}
                  conv={conv}
                  isActive={conv.sessionId === activeConversationId}
                  onSelect={() => {
                    onSelectSession(conv);
                    onClose();
                  }}
                  onDelete={() => onDeleteSession(conv)}
                  onRename={newTitle => onRenameSession(conv, newTitle)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ─── AIScreen ─────────────────────────────────────────────────────────────────

const AIScreen = (): ReactElement => {
  const [chatKey, setChatKey] = useState(0);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [pendingConversationId, setPendingConversationId] = useState<string | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: sessions = [], refetch: refetchSessions } = useSessionsList();
  const { deleteSession: deleteSessionMutation, rename: renameMutation } = useSessionMutations();

  // Close the channel AI sidebar if it was left open when navigating here
  useEffect(() => {
    xyneAIActor.send({ type: 'CLOSE' });
  }, []);

  // Close panel on outside click
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!historyOpen) return;
    const handler = (e: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [historyOpen]);

  const handleClose = (): void => {
    setChatKey(k => k + 1);
    setPendingConversationId(undefined);
    setActiveConversationId('');
  };

  const handleSelectSession = (conv: ConversationHistoryType): void => {
    if (conv.sessionId === activeConversationId) return;
    setActiveConversationId(conv.sessionId);
    setPendingConversationId(conv.sessionId);
    setChatKey(k => k + 1);
  };

  const handleConversationChange = useCallback(
    (id: string): void => {
      setActiveConversationId(id);
      void refetchSessions();
    },
    [refetchSessions],
  );

  const handleDeleteSession = async (conv: ConversationHistoryType): Promise<void> => {
    await deleteSessionMutation.mutateAsync(conv.sessionId);
    if (activeConversationId === conv.sessionId) handleClose();
  };

  const handleRenameSession = async (
    conv: ConversationHistoryType,
    newTitle: string,
  ): Promise<void> => {
    await renameMutation.mutateAsync({ sessionId: conv.sessionId, title: newTitle });
  };

  return (
    <div className='relative h-full min-h-full bg-background overflow-hidden md:rounded-2xl'>
      {/* ── Floating history trigger + panel ── */}
      <div ref={panelRef} className='absolute top-3 left-3 z-30'>
        {/* Trigger button — hidden when panel is open */}
        {!historyOpen && (
          <button
            type='button'
            onClick={() => setHistoryOpen(true)}
            title='Session history'
            data-track-category='AIScreen'
            data-track-name='OPEN_HISTORY_PANEL'
            className={cn(
              'flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-200',
              'bg-background/70 backdrop-blur-md',
              'border border-border/40 shadow-sm',
              'text-muted-foreground/70 hover:text-foreground',
              'hover:bg-muted/60 hover:shadow-md hover:scale-[1.05]',
              'active:scale-[0.96]',
            )}
          >
            <History size={16} strokeWidth={1.8} />
          </button>
        )}

        {/* Floating panel — replaces the trigger when open */}
        {historyOpen && (
          <HistoryPanel
            conversations={sessions}
            activeConversationId={activeConversationId}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </div>

      {/* Full-width AI sidebar */}
      <XyneAISidebar
        key={chatKey}
        channelId={null}
        variant='fullscreen'
        onClose={handleClose}
        startFreshChat={false}
        {...(pendingConversationId !== undefined
          ? { initialConversationId: pendingConversationId }
          : {})}
        onConversationChange={handleConversationChange}
      />
    </div>
  );
};

export default AIScreen;
