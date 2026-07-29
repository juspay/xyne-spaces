import { ReactElement, useMemo } from 'react';
import { Tag as TagIcon, X, Inbox } from 'lucide-react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

/**
 * Right-panel view for a single label: lists the email conversations carrying it.
 * Opened by clicking a label in the desk sidebar's Labels section.
 */

interface LabelThreadsViewProps {
  labelId: string;
  labelName: string;
  channelId: string;
  onOpenTicket: (item: {
    channelId: string;
    ticketXyneId: string;
    ticketId: string;
    conversationId: string;
  }) => void;
  onClose: () => void;
}

export const LabelThreadsView = ({
  labelId,
  labelName,
  channelId,
  onOpenTicket,
  onClose,
}: LabelThreadsViewProps): ReactElement => {
  const [mappings] = useCachedQuery(queries.conversationLabelMappingsByLabelId({ labelId }), {
    enabled: !!labelId,
  });
  const rows = useMemo(() => mappings ?? [], [mappings]);

  return (
    <div className='h-full flex flex-col bg-background'>
      <div className='flex-shrink-0 h-14 border-b border-border flex items-center justify-between px-4'>
        <div className='flex items-center gap-2 font-semibold min-w-0'>
          <TagIcon size={16} className='text-muted-foreground shrink-0' />
          <span className='text-base truncate'>{labelName}</span>
        </div>
        <button
          onClick={onClose}
          className='p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors'
          aria-label='Close label view'
          title='Close'
          data-track-category='Support'
          data-track-name='CloseLabelThreads'
        >
          <X size={16} />
        </button>
      </div>

      <div className='flex-1 min-h-0 overflow-y-auto'>
        {rows.length === 0 ? (
          <div className='h-full flex flex-col items-center justify-center gap-2 text-center text-muted-foreground px-6'>
            <Inbox size={26} className='text-muted-foreground/70' />
            <p className='text-sm font-medium text-foreground'>No conversations</p>
            <p className='text-xs text-muted-foreground max-w-sm'>
              Apply this label to an email thread from the label button next to its subject, and it
              will show up here.
            </p>
          </div>
        ) : (
          <div className='flex flex-col'>
            {rows.map(m => {
              const conversation = m.conversation;
              const ticket = conversation?.ticket;
              const title = ticket?.title?.trim() || '(no subject)';
              return (
                <button
                  key={m.id}
                  type='button'
                  disabled={!ticket}
                  onClick={() => {
                    if (!ticket || !conversation) return;
                    onOpenTicket({
                      channelId: conversation.channelId ?? channelId,
                      ticketXyneId: ticket.xyneId,
                      ticketId: ticket.id,
                      conversationId: m.conversationId,
                    });
                  }}
                  className='flex items-center gap-2 px-4 py-2.5 border-b border-border/60 hover:bg-muted/50 transition-colors text-left disabled:opacity-50'
                  data-track-category='Support'
                  data-track-name='OpenLabeledConversation'
                >
                  <Inbox size={14} className='text-muted-foreground shrink-0' />
                  <span className='text-sm truncate'>{title}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
