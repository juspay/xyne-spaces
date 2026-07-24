import { ReactElement } from 'react';
import { Calendar, CheckCircle2, Mail, User, UserPlus } from 'lucide-react';
import type { DisplaySearchResult } from '../../../types/search';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import Avatar from '../../ui/Avatar/Avatar';

export interface TicketPreviewPanelProps {
  ticket: DisplaySearchResult | null;
  onClose: () => void;
}

/**
 * Get status color based on ticket status
 */
const getStatusStyles = (status?: string): { bg: string; text: string; dot: string } => {
  switch (status?.toUpperCase()) {
    case 'TODO':
    case 'OPEN':
      return { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' };
    case 'STARTED':
    case 'IN_PROGRESS':
      return { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' };
    case 'PAUSED':
      return { bg: 'bg-cyan-50', text: 'text-cyan-700', dot: 'bg-cyan-500' };
    case 'COMPLETED':
    case 'DONE':
    case 'CLOSED':
      return { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' };
    case 'CANCELED':
    case 'CANCELLED':
      return { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' };
  }
};

/**
 * Format relative time (e.g., "2 hours ago")
 */
const getRelativeTime = (dateString?: string): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

/**
 * TicketPreviewPanel - Displays ticket details in a side panel within the search/command menu.
 * Similar to Linear's preview navigation experience.
 */
export const TicketPreviewPanel = ({ ticket }: TicketPreviewPanelProps): ReactElement | null => {
  if (!ticket) return null;

  const { title, context, metadata, searchContext } = ticket;
  const isDesk = ticket.type === 'conversation' && searchContext?.subApp === 'DESK';
  const statusStyles = getStatusStyles(searchContext?.ticketStatus);

  return (
    <div className='flex min-h-0 flex-col self-stretch overflow-hidden border-l border-border/30 w-80 flex-shrink-0 bg-background'>
      {/* Header */}
      <div className='flex shrink-0 items-center justify-between px-4 py-3 border-b border-border/30 bg-muted/30'>
        <div className='flex items-center gap-2'>
          <div className='p-1.5 bg-primary/10 rounded-md'>
            {isDesk ? (
              <Mail size={14} className='text-primary' />
            ) : (
              <CheckCircle2 size={14} className='text-primary' />
            )}
          </div>
          <span className='text-sm font-semibold text-foreground'>
            {isDesk ? 'Desk Preview' : 'Ticket Preview'}
          </span>
        </div>
      </div>

      {/* Ticket Content */}
      <div className='flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain'>
        {/* Title Section */}
        <div className='p-4 pb-3 border-b border-border/30'>
          {/* XYNE ID */}
          {searchContext?.xyneId && (
            <div className='flex items-center gap-2.5 mb-3'>
              <span className='text-xs font-mono font-medium text-muted-foreground px-2 py-0.5 bg-muted rounded border'>
                {searchContext.xyneId}
              </span>
            </div>
          )}

          {/* Title */}
          <h2 className='text-base font-semibold text-foreground leading-relaxed'>
            <RenderMessageWithHTML message={title} />
          </h2>
        </div>

        {/* Description */}
        {context && (
          <div className='px-4 py-3 border-b border-border/30'>
            <p className='text-sm text-muted-foreground leading-relaxed'>
              <RenderMessageWithHTML message={context} />
            </p>
          </div>
        )}

        {isDesk && (searchContext?.senderName || searchContext?.senderEmail) && (
          <div className='p-4 border-b border-border/30'>
            <div className='flex items-center gap-3'>
              <div className='flex items-center justify-center w-8 h-8 rounded-md bg-blue-50 flex-shrink-0'>
                <User size={14} className='text-blue-600' />
              </div>
              <div className='flex flex-col min-w-0'>
                <span className='text-xs text-muted-foreground uppercase tracking-wider font-medium'>
                  Sender
                </span>
                <span className='text-sm font-medium text-foreground truncate mt-0.5'>
                  {searchContext.senderName || searchContext.senderEmail}
                </span>
                {searchContext.senderName && searchContext.senderEmail && (
                  <span className='text-xs text-muted-foreground truncate'>
                    {searchContext.senderEmail}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* People Section */}
        {(searchContext?.assignedTo || searchContext?.createdBy) && (
          <div className='p-4 border-b border-border/30 space-y-3'>
            {/* Assignee */}
            {searchContext?.assignedTo && (
              <div className='flex items-center gap-3'>
                <div className='flex items-center justify-center w-8 h-8 rounded-md bg-blue-50 flex-shrink-0'>
                  <User size={14} className='text-blue-600' />
                </div>
                <div className='flex flex-col min-w-0'>
                  <span className='text-xs text-muted-foreground uppercase tracking-wider font-medium'>
                    Assignee
                  </span>
                  <div className='flex items-center gap-2 mt-0.5'>
                    <Avatar userId={searchContext.assignedTo} size='xs' />
                    <span className='text-sm font-medium text-foreground truncate'>
                      {searchContext.assigneeName || 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Creator */}
            {searchContext?.createdBy && (
              <div className='flex items-center gap-3'>
                <div className='flex items-center justify-center w-8 h-8 rounded-md bg-purple-50 flex-shrink-0'>
                  <UserPlus size={14} className='text-purple-600' />
                </div>
                <div className='flex flex-col min-w-0'>
                  <span className='text-xs text-muted-foreground uppercase tracking-wider font-medium'>
                    Created by
                  </span>
                  <div className='flex items-center gap-2 mt-0.5'>
                    <Avatar userId={searchContext.createdBy} size='xs' />
                    <span className='text-sm font-medium text-foreground truncate'>
                      {searchContext.creatorName || 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Status */}
            {searchContext?.ticketStatus && (
              <div className='flex items-center gap-3 pt-1'>
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-md flex-shrink-0 ${statusStyles.bg}`}
                >
                  <span className={`w-3 h-3 rounded-full ${statusStyles.dot}`} />
                </div>
                <div className='flex flex-col min-w-0'>
                  <span className='text-xs text-muted-foreground uppercase tracking-wider font-medium'>
                    Status
                  </span>
                  <span className={`text-sm font-medium mt-0.5 ${statusStyles.text}`}>
                    {searchContext.ticketStatus}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Created Date */}
        {metadata?.timestamp && (
          <div className='p-4'>
            <div className='flex items-center gap-3 text-muted-foreground'>
              <div className='flex items-center justify-center w-8 h-8 rounded-md bg-gray-100 flex-shrink-0'>
                <Calendar size={14} className='text-gray-600' />
              </div>
              <div className='flex flex-col'>
                <span className='text-xs text-muted-foreground uppercase tracking-wider font-medium'>
                  Created
                </span>
                <span className='text-sm text-foreground mt-0.5'>
                  {metadata.timestamp}
                  <span className='text-muted-foreground/70 ml-1.5'>
                    ({getRelativeTime(metadata.timestamp)})
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
