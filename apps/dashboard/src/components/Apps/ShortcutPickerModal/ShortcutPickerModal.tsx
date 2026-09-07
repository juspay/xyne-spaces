import React, { useState, useMemo } from 'react';
import { Zap, Search, X } from 'lucide-react';
import Button from '../../ui/Button';
import { appsService, type AppShortcutWithApp } from '../../../services/Apps/appsService';
import { toast } from 'sonner';

interface ShortcutPickerModalProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
  conversationId?: string | null;
  /** If provided, shows a message preview card and dispatches as message_shortcut */
  message?:
    | {
        text: string;
        senderName: string;
        messageId: string;
      }
    | undefined;
  shortcuts: AppShortcutWithApp[];
}

/**
 * Modal that shows all available shortcuts for a channel.
 * - For global shortcuts: no message preview
 * - For message shortcuts: shows message preview card at top
 */
export const ShortcutPickerModal: React.FC<ShortcutPickerModalProps> = ({
  open,
  onClose,
  channelId,
  conversationId,
  message,
  shortcuts,
}) => {
  const [search, setSearch] = useState('');
  const [dispatching, setDispatching] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shortcuts;
    return shortcuts.filter(
      s =>
        (s.commandName ?? '').toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.appName ?? '').toLowerCase().includes(q),
    );
  }, [shortcuts, search]);

  // Group by appName
  const grouped = useMemo(() => {
    const map = new Map<string, AppShortcutWithApp[]>();
    for (const s of filtered) {
      const existing = map.get(s.appName) ?? [];
      existing.push(s);
      map.set(s.appName, existing);
    }
    return map;
  }, [filtered]);

  const handleSelect = async (shortcut: AppShortcutWithApp) => {
    setDispatching(shortcut.commandName);
    try {
      await appsService.executeShortcutAction(
        channelId,
        shortcut.commandName,
        conversationId ?? null,
        message?.text ?? '',
        message?.messageId,
      );
      onClose();
    } catch {
      toast.error(`Failed to run shortcut "${shortcut.commandName}"`);
    } finally {
      setDispatching(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className='fixed inset-0 z-[100] flex items-center justify-center'
      role='button'
      tabIndex={0}
      aria-label='Close shortcuts modal'
      data-track-category='shortcut-picker'
      data-track-name='close-modal-backdrop'
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className='absolute inset-0 bg-black/40' />

      {/* Modal */}
      <div className='relative z-10 w-[480px] max-h-[70vh] flex flex-col rounded-xl border border-border bg-popover shadow-xl'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
          <div className='flex items-center gap-2'>
            <Zap className='w-4 h-4 text-muted-foreground' />
            <h2 className='text-sm font-semibold text-foreground'>
              {message ? 'Use a shortcut' : 'Global shortcuts'}
            </h2>
          </div>
          <Button
            variant='ghost'
            size='sm'
            className='h-7 w-7 p-0'
            onClick={onClose}
            data-track-category='shortcut-picker'
            data-track-name='close-modal-button'
          >
            <X className='w-4 h-4' />
          </Button>
        </div>

        {/* Message preview (for message shortcuts) */}
        {message && (
          <div className='mx-4 mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2'>
            <p className='text-xs font-medium text-muted-foreground mb-0.5'>{message.senderName}</p>
            <p className='text-sm text-foreground line-clamp-2'>{message.text}</p>
          </div>
        )}

        {/* Search */}
        <div className='px-4 py-2'>
          <div className='relative'>
            <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground' />
            <input
              autoFocus
              type='text'
              placeholder={message ? 'Search message shortcuts...' : 'Search shortcuts...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-track-category='shortcut-picker'
              data-track-name='search-shortcuts'
              className='w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
            />
          </div>
        </div>

        {/* List */}
        <div className='flex-1 overflow-y-auto px-2 pb-2'>
          {grouped.size === 0 ? (
            <p className='text-sm text-muted-foreground text-center py-8'>No shortcuts found</p>
          ) : (
            Array.from(grouped.entries()).map(([appName, appShortcuts]) => (
              <div key={appName} className='mb-1'>
                <p className='text-[11px] font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider'>
                  {appName}
                </p>
                {appShortcuts.map(shortcut => (
                  <button
                    key={shortcut.commandName}
                    type='button'
                    data-ph-capture-attribute-track-id='run_shortcut'
                    disabled={dispatching === shortcut.commandName}
                    onClick={() => void handleSelect(shortcut)}
                    data-track-category='shortcut-picker'
                    data-track-name='run-shortcut'
                    className='w-full h-auto flex items-start justify-start gap-3 px-2 py-2 rounded-md hover:bg-accent transition-colors text-left disabled:opacity-50'
                  >
                    <div className='flex-shrink-0 w-7 h-7 rounded bg-primary/10 flex items-center justify-center mt-0.5'>
                      <Zap className='w-3.5 h-3.5 text-primary' />
                    </div>
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-medium text-foreground leading-tight'>
                        {shortcut.commandName}
                      </p>
                      {shortcut.description && (
                        <p className='text-xs text-muted-foreground mt-0.5 line-clamp-1'>
                          {shortcut.description}
                        </p>
                      )}
                    </div>
                    {dispatching === shortcut.commandName && (
                      <span className='text-xs text-muted-foreground self-center'>Running…</span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
