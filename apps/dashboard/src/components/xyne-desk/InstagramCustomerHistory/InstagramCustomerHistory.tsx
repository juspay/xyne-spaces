import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { apiInstance } from '../../../services/clients/apiClient';

interface PreviousTicket {
  id: string;
  xyneId: string;
  title: string;
  stageName: string;
  createdAt: string;
  conversationId: string;
}

interface Props {
  channelId: string;
  conversationId: string;
  onTicketClick: (xyneId: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  return `${Math.floor(m / 12)}y ago`;
}

export function InstagramCustomerHistory({ channelId, conversationId, onTicketClick }: Props) {
  const [tickets, setTickets] = useState<PreviousTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!channelId || !conversationId) return;
    setLoading(true);
    void apiInstance
      .get<{ igsid: string | null; tickets: PreviousTicket[] }>(
        `/integrations/social-media/${channelId}/customer-history`,
        { params: { conversationId } },
      )
      .then(res => {
        setTickets(res.data.tickets);
      })
      .catch(() => {
        setTickets([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [channelId, conversationId]);

  if (loading || tickets.length === 0) return null;

  return (
    <div className='border-t border-border mt-2'>
      <button
        type='button'
        onClick={() => setExpanded(v => !v)}
        className='flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors'
        data-track-category='InstagramCustomerHistory'
        data-track-name='ToggleCustomerHistory'
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Previous conversations</span>
        <span className='ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full'>
          {tickets.length}
        </span>
      </button>

      {expanded && (
        <div className='px-4 pb-3 flex flex-col gap-1'>
          {tickets.map(t => (
            <button
              key={t.id}
              type='button'
              onClick={() => onTicketClick(t.xyneId)}
              className='flex flex-col gap-0.5 w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors group'
              data-track-category='InstagramCustomerHistory'
              data-track-name='OpenPreviousTicket'
            >
              <div className='flex items-center gap-2 min-w-0'>
                <span className='text-xs font-mono text-muted-foreground shrink-0'>{t.xyneId}</span>
                <span className='text-xs text-foreground truncate flex-1'>{t.title}</span>
              </div>
              <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                <Clock size={10} />
                <span>{timeAgo(t.createdAt)}</span>
                <span className='ml-auto'>{t.stageName}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
