import { X, Hash, MessageSquare, Ticket, Paperclip, User, Check } from 'lucide-react';
import { Button } from '../../ui/Button';
import type { ThreadContextPanelProps, ContextItem } from './ThreadContextPanel.types';
import type { DisplayEntityType } from '../../../types/search';

const entityIcon = (type: DisplayEntityType): React.ReactElement => {
  switch (type) {
    case 'channel':
      return <Hash size={12} className='flex-shrink-0 text-muted-foreground' />;
    case 'conversation':
      return <MessageSquare size={12} className='flex-shrink-0 text-muted-foreground' />;
    case 'ticket':
      return <Ticket size={12} className='flex-shrink-0 text-muted-foreground' />;
    case 'attachment':
      return <Paperclip size={12} className='flex-shrink-0 text-muted-foreground' />;
    case 'user':
      return <User size={12} className='flex-shrink-0 text-muted-foreground' />;
    case 'collection':
      return <Paperclip size={12} className='flex-shrink-0 text-gray-500' />;
  }
};

const ContextItemRow = ({
  item,
  onRemove,
}: {
  item: ContextItem;
  onRemove: (id: string) => void;
}): React.ReactElement => (
  <div className='flex items-center gap-1.5 px-3 py-1.5 group hover:bg-accent rounded-sm'>
    {entityIcon(item.type)}
    <span className='flex-1 min-w-0 text-xs text-foreground truncate'>{item.title}</span>
    <button
      onClick={() => onRemove(item.id)}
      className='flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground rounded'
      aria-label={`Remove ${item.title}`}
      data-track-category='THREAD_CONTEXT'
      data-track-name='REMOVE_CONTEXT_ITEM'
      data-track-metdata={JSON.stringify({ itemId: item.id, itemType: item.type })}
    >
      <X size={12} />
    </button>
  </div>
);

const ThreadContextPanel = ({
  items,
  onRemove,
  onConfirm,
}: ThreadContextPanelProps): React.ReactElement => {
  const handleClearAll = (): void => {
    items.forEach(item => onRemove(item.id));
  };

  return (
    <div className='flex flex-col h-full border-l border-border w-56 flex-shrink-0 bg-background'>
      {/* Header */}
      <div className='flex items-center justify-between px-3 py-2 border-b border-border'>
        <div className='flex items-center gap-1.5'>
          <Check size={13} className='text-primary' />
          <span className='text-xs font-semibold text-foreground'>
            Context{items.length > 0 ? ` (${items.length})` : ''}
          </span>
        </div>
        {items.length > 0 && (
          <button
            onClick={handleClearAll}
            className='text-[10px] text-muted-foreground hover:text-foreground transition-colors'
            data-track-category='THREAD_CONTEXT'
            data-track-name='CLEAR_ALL_CONTEXT_ITEMS'
            data-track-metdata={JSON.stringify({ itemCount: items.length })}
          >
            Clear all
          </button>
        )}
      </div>

      {/* Item list */}
      <div className='flex-1 overflow-y-auto py-1'>
        {items.length === 0 ? (
          <p className='px-3 py-4 text-xs text-muted-foreground text-center leading-relaxed'>
            Search and click items to add them as context
          </p>
        ) : (
          items.map(item => <ContextItemRow key={item.id} item={item} onRemove={onRemove} />)
        )}
      </div>

      {/* Footer */}
      <div className='px-3 pb-3 pt-2 border-t border-border'>
        <Button
          variant='default'
          size='sm'
          className='w-full text-xs'
          disabled={items.length === 0}
          onClick={onConfirm}
          data-track-category='THREAD_CONTEXT'
          data-track-name='CONFIRM_THREAD_CONTEXT'
        >
          Add to Thread
        </Button>
      </div>
    </div>
  );
};

export default ThreadContextPanel;
