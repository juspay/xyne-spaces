import React, { ReactElement, useContext, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { TicketCardV2 } from '../../Tickets/TicketCardV2/TicketCardV2';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import { useAllVisibleChannels, useChannel } from '../../../hooks/useChannels';
import { usePlatform } from '../../../hooks/usePlatform';

import { parseTicketMd, parseSubTicketsMd } from '@xyne/shared';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { standaloneNavigate } from '../../../utils/electronApp';
import { useLocation } from 'react-router-dom';
import { SearchResultsContext } from '../SearchResults/SearchResultsContext';
import { useNavigate } from '../../../hooks/useWorkspaceNavigate';

interface BotBubbleProps {
  messageId?: string;
  messageContent?: string;
  channelId?: string;
  conversation?: ConversationWithTicket;
  isModalOpen?: boolean;
  renderTicketCard?: boolean;
  context?: 'channel' | 'thread' | undefined;
  onModalOpenChange?: (isOpen: boolean) => void;
  onTicketCreated?: (ticket: {
    id: string;
    conversationId?: string;
    createdBy?: string;
    assignedTo?: string;
    workflowType?: string;
    xyneId?: string;
  }) => void;
}

const stripHtml = (html: string): string => {
  const tmp = document.createElement('DIV');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
};

type TicketCardSummaryFromMd = NonNullable<ReturnType<typeof parseTicketMd>>;

type TicketCardTarget = {
  id: string;
  channelId?: string | null;
  conversationId?: string | null;
};

const useOpenTicketCard = (
  conversationContext?: 'channel' | 'thread',
  fallbackChannelId?: string,
  fallbackConversationId?: string,
): ((ticket: TicketCardTarget, e: React.MouseEvent | KeyboardEvent) => void) => {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const { isMobile } = usePlatform();
  const location = useLocation();
  const { onSelectThread: onSelectSearchThread } = useContext(SearchResultsContext);

  // In the Desk/email ticket-detail view the user is already looking at the
  // ticket whose card is being rendered in the right-panel thread — instead
  // of bouncing them into the Chat ticket URL, flip the right panel to the
  // Details tab via a `?selectedTab=details` URL param. SupportTicketDetail
  // watches this param reactively.
  const isDeskView = location.pathname.includes('/support');

  return (ticket, e) => {
    const resolvedChannelId = ticket.channelId || fallbackChannelId;
    const resolvedConversationId = ticket.conversationId || fallbackConversationId;
    if (!resolvedChannelId || !resolvedConversationId) return;

    if (isDeskView) {
      const params = new URLSearchParams(location.search);
      params.set('selectedTab', 'details');
      void navigate(`${location.pathname}?${params.toString()}`, { replace: true });
      return;
    }

    const isCmdClick = 'metaKey' in e && (e.metaKey || e.ctrlKey);

    if (!isMobile && isCmdClick) {
      const ws = window.location.pathname.split('/').find(s => s.length > 0) ?? '';
      const ticketUrl = `${ws ? `/${ws}` : ''}/chat/dir/${resolvedChannelId}?tab=tickets&ticketId=${ticket.id}&conversationId=${resolvedConversationId}`;
      window.open(ticketUrl, '_blank');
      return;
    }

    if (onSelectSearchThread) {
      onSelectSearchThread({
        channelId: resolvedChannelId,
        conversationId: resolvedConversationId,
      });
      return;
    }

    const event = 'clientX' in e ? e : undefined;

    if (conversationContext === 'channel' || conversationContext === 'thread') {
      standaloneNavigate(
        navigate,
        `${baseRoute}/${resolvedChannelId}/${resolvedConversationId}/${ticket.id}?selectedTab=details`,
        { event },
      );
    } else {
      standaloneNavigate(navigate, `${baseRoute}/${resolvedChannelId}/${resolvedConversationId}`, {
        event,
      });
    }
  };
};

const TicketDisplayModeV2: React.FC<{
  ticket: TicketCardSummaryFromMd;
  channelId?: string;
  conversationContext?: 'channel' | 'thread' | undefined;
  conversationId?: string;
}> = ({ ticket, channelId, conversationContext, conversationId }) => {
  const openTicketCard = useOpenTicketCard(conversationContext, channelId, conversationId);

  if (!(ticket.channelId || channelId) || !(ticket.conversationId || conversationId)) {
    return null;
  }

  return (
    <div className='w-full mt-2'>
      <TicketCardV2
        ticket={ticket}
        onClick={e => openTicketCard(ticket, e)}
        isConversation={true}
      />
    </div>
  );
};

const SubTicketsTree: React.FC<{
  parentTicket: TicketCardSummaryFromMd;
  subTicketsMd: string;
  channelId?: string;
  conversationContext?: 'channel' | 'thread' | undefined;
  conversationId?: string;
}> = ({ parentTicket, subTicketsMd, channelId, conversationContext, conversationId }) => {
  const openTicketCard = useOpenTicketCard(conversationContext, channelId, conversationId);
  const visibleChannels = useAllVisibleChannels();
  const accessibleChannelIds = useMemo(
    () => new Set(visibleChannels.map(channel => channel.id)),
    [visibleChannels],
  );
  const { total, items } = useMemo(() => parseSubTicketsMd(subTicketsMd), [subTicketsMd]);

  if (items.length === 0) return null;

  const shown = items.slice(0, 2);
  const hasMore = total > 2;

  return (
    <div className='w-full'>
      {shown.map((child, index) => {
        const hasFollowingRow = index < shown.length - 1 || hasMore;
        const canOpen = !child.channelId || accessibleChannelIds.has(child.channelId);
        return (
          <div key={child.id} className='flex items-stretch'>
            <div className='relative w-9 shrink-0'>
              <div className='absolute bottom-1/2 left-3.5 right-0 top-0 rounded-bl-[10px] border-b-2 border-l-2 border-border' />
              {hasFollowingRow && (
                <div className='absolute -bottom-2 left-3.5 top-1/2 border-l-2 border-border' />
              )}
            </div>
            <div
              className={canOpen ? 'min-w-0 flex-1 pt-2' : 'min-w-0 flex-1 cursor-not-allowed pt-2'}
              {...(!canOpen && { title: 'You do not have access to this ticket' })}
            >
              <div className={canOpen ? undefined : 'pointer-events-none opacity-60'}>
                <TicketCardV2
                  ticket={child}
                  isConversation
                  {...(canOpen && {
                    onClick: (e: React.MouseEvent | KeyboardEvent) => openTicketCard(child, e),
                  })}
                />
              </div>
            </div>
          </div>
        );
      })}
      {hasMore && (
        <div className='flex items-stretch'>
          <div className='relative w-9 shrink-0'>
            <div className='absolute bottom-1/2 left-3.5 right-0 top-0 rounded-bl-[10px] border-b-2 border-l-2 border-border' />
          </div>
          <div className='pt-2.5'>
            <button
              type='button'
              className='inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              onClick={e => openTicketCard(parentTicket, e)}
              data-track-category='TICKET_CARD'
              data-track-name='VIEW_ALL_SUB_TICKETS'
              data-track-metadata={JSON.stringify({ ticketId: parentTicket.id })}
            >
              View all {total} sub-tickets
              <ChevronRight className='size-3.5' />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Create ticket from message - wrapper component that handles hooks properly
const TicketCreateModeWithChannel: React.FC<{
  messageId: string;
  messageContent: string;
  channelId: string;
  conversation: ConversationWithTicket | null;
  isModalOpen: boolean;
  onModalOpenChange: (isOpen: boolean) => void;
  onTicketCreated?: (ticket: { id: string; conversationId?: string }) => void;
}> = ({
  messageId,
  messageContent,
  channelId,
  conversation,
  isModalOpen,
  onModalOpenChange,
  onTicketCreated,
}) => {
  const channel = useChannel(channelId);
  const projectId = channel?.projectId || '';

  if (!channel) return null;

  const handleTicketCreated = (ticket: {
    id: string;
    conversationId?: string;
    createdBy?: string;
    assignedTo?: string;
    workflowType?: string;
    xyneId?: string;
  }): void => {
    onModalOpenChange(false);

    // Call the callback to handle linking in the parent component
    if (onTicketCreated) {
      onTicketCreated(ticket);
    }
  };

  return isModalOpen ? (
    <CreateTicketModal
      isOpen={isModalOpen}
      onClose={() => onModalOpenChange(false)}
      channelId={channelId}
      projectId={projectId}
      initialTitle=''
      initialDescription={stripHtml(messageContent)}
      sourceMessageId={messageId}
      sourceConversation={conversation ?? undefined}
      {...(onTicketCreated && { onTicketCreated: handleTicketCreated })}
    />
  ) : null;
};

export const BotBubble: React.FC<BotBubbleProps> = ({
  messageId,
  messageContent = '',
  channelId,
  conversation,
  context,
  isModalOpen = false,
  renderTicketCard = true,
  onModalOpenChange,
  onTicketCreated,
}): ReactElement | null => {
  const ticketMd = (conversation as { ticket_md?: string | null } | undefined)?.ticket_md;
  const ticketSummary = ticketMd ? parseTicketMd(ticketMd) : null;
  const subTicketsMd = conversation?.sub_tickets_md;

  // Display existing ticket (md-only)
  if (renderTicketCard && ticketSummary && conversation?.initialMessageId === messageId) {
    return (
      <>
        <TicketDisplayModeV2
          ticket={ticketSummary}
          conversationContext={context}
          {...(channelId && { channelId: channelId })}
          {...(conversation && { conversationId: conversation.conversationId })}
        />
        {subTicketsMd && (
          <SubTicketsTree
            parentTicket={ticketSummary}
            subTicketsMd={subTicketsMd}
            conversationContext={context}
            {...(channelId && { channelId: channelId })}
            {...(conversation && { conversationId: conversation.conversationId })}
          />
        )}
      </>
    );
  }

  if (!isModalOpen) return null;

  // Show create ticket modal
  if (messageId && messageContent && channelId && onModalOpenChange && conversation) {
    return (
      <TicketCreateModeWithChannel
        messageId={messageId}
        messageContent={messageContent}
        channelId={channelId}
        conversation={conversation}
        isModalOpen={isModalOpen}
        onModalOpenChange={onModalOpenChange}
        {...(onTicketCreated && { onTicketCreated })}
      />
    );
  }

  return null;
};
