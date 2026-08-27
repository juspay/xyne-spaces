import React, { useState } from 'react';
import { parsePulseMarkdown, type PulseItem } from '../../../utils/parsePulseMarkdown';
import { PulseCreateActionableModal } from './PulseCreateActionableModal';

// Re-export PulseItem so MessageBubble can import from one place
export type { PulseItem };

interface PulseTicketsProps {
  content: string;
  callId: string;
  conversationId: string;
  messageId: string;
}

export const PulseTickets: React.FC<PulseTicketsProps> = ({
  content,
  callId,
  conversationId,
  messageId,
}) => {
  const { merchants, pulseItems, pulseSent } = parsePulseMarkdown(content);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [queue, setQueue] = useState<PulseItem[]>([]);
  const [initialQueueLength, setInitialQueueLength] = useState(0);

  if (pulseItems.length === 0 && pulseSent.length === 0) return null;

  const activeItem = queue[0] ?? null;

  const toggleSelection = (itemId: string) => {
    setSelectedIds(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId],
    );
  };

  const startCreation = () => {
    const items = pulseItems.filter(i => selectedIds.includes(i.itemId));
    if (items.length > 0) {
      setInitialQueueLength(items.length);
      setQueue(items);
    }
  };

  const handleModalClose = () => {
    // Cancel — discard the entire remaining queue
    setQueue([]);
    setSelectedIds([]);
  };

  const handleActionableCreated = () => {
    // Remove the just-submitted item from selections, then advance to the next item
    if (activeItem) {
      setSelectedIds(prev => prev.filter(id => id !== activeItem.itemId));
    }
    setQueue(prev => {
      const next = prev.slice(1);
      if (next.length === 0) {
        // Last item done — clear selections
        setSelectedIds([]);
      }
      return next;
    });
  };

  // Map merchant IDs to names/details
  const merchantMap = new Map(merchants.map(m => [m.id, m]));
  const activeMerchant = activeItem ? merchantMap.get(activeItem.merchantId) : null;

  return (
    <div className='mt-1 pl-2 -ml-8'>
      {/* Section heading */}
      <div className='flex items-center gap-1.5 mb-2 ml-4'>
        <span className='text-xs font-semibold text-muted-foreground tracking-wide uppercase'>
          Pulse Actionables
        </span>
      </div>

      {merchants.map(merchant => {
        const merchantItems = pulseItems.filter(i => i.merchantId === merchant.id);
        const merchantSent = pulseSent.filter(i => i.merchantId === merchant.id);

        if (merchantItems.length === 0 && merchantSent.length === 0) return null;

        return (
          <div key={merchant.id} className='mb-4 ml-4'>
            <div className='text-xs font-medium text-action-primary mb-1 flex items-center gap-1'>
              {merchant.name}
            </div>

            {/* Already-sent items for this merchant */}
            {merchantSent.map(item => (
              <div key={item.itemId} className='flex items-start gap-2 py-1.5 opacity-50'>
                <span className='mt-[5px] text-xs text-status-success'>✓</span>
                <span className='text-sm text-muted-foreground line-through flex-1'>
                  {item.content}
                </span>
              </div>
            ))}

            {/* Pending items for this merchant */}
            {merchantItems.map(item => {
              const checkboxId = `pulse-item-${item.itemId}`;
              const isSelected = selectedIds.includes(item.itemId);

              return (
                <div key={item.itemId} className='flex items-start gap-2 py-1.5'>
                  <input
                    id={checkboxId}
                    type='checkbox'
                    checked={isSelected}
                    onChange={() => toggleSelection(item.itemId)}
                    data-track-category='MESSAGE'
                    data-track-name='TOGGLE_PULSE_TICKET'
                    className='mt-1 h-4 w-4 shrink-0 rounded border-input cursor-pointer'
                  />
                  <label htmlFor={checkboxId} className='text-sm text-left flex-1 cursor-pointer'>
                    <span className='font-medium text-foreground'>{item.content}</span>
                    {item.assignee && item.assignee !== 'unassigned' && (
                      <>
                        <span className='text-muted-foreground font-normal'>
                          {' '}
                          — {item.assignee}
                        </span>
                      </>
                    )}
                  </label>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Create button — visible only when items are selected */}
      {selectedIds.length > 0 && (
        <div className='pt-1 ml-4'>
          <button
            onClick={startCreation}
            data-track-category='MESSAGE'
            data-track-name='START_TICKET_FROM_PULSE'
            className='text-sm font-medium text-action-primary hover:underline bg-transparent border-none p-0 cursor-pointer'
          >
            Create Actionable ({selectedIds.length})
          </button>
        </div>
      )}

      {/* Modal — opens for each selected item in sequence */}
      {activeItem && (
        <PulseCreateActionableModal
          key={activeItem.itemId}
          isOpen={true}
          onClose={handleModalClose}
          callId={callId}
          item={activeItem}
          merchant={activeMerchant ?? null}
          conversationId={conversationId}
          messageId={messageId}
          onSuccess={handleActionableCreated}
          queuePosition={{
            current: initialQueueLength - queue.length + 1,
            total: initialQueueLength,
          }}
        />
      )}
    </div>
  );
};
