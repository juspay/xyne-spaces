import React, { ReactElement, useContext } from 'react';
import { TicketCardV2 } from '../../Tickets/TicketCardV2/TicketCardV2';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import { useChannel } from '../../../hooks/useChannels';
import { usePlatform } from '../../../hooks/usePlatform';

import { parseTicketMd } from '@xyne/shared';
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

const TicketDisplayModeV2: React.FC<{
  ticket: TicketCardSummaryFromMd;
  channelId?: string;
  conversationContext?: 'channel' | 'thread' | undefined;
  conversationId?: string;
}> = ({ ticket, channelId, conversationContext, conversationId }) => {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const { isMobile } = usePlatform();
  const location = useLocation();
  const { onSelectThread: onSelectSearchThread } = useContext(SearchResultsContext);

  const resolvedChannelId = ticket.channelId || channelId;
  const resolvedConversationId = ticket.conversationId || conversationId;

  if (!resolvedChannelId || !resolvedConversationId) {
    return null;
  }

  // In the Desk/email ticket-detail view the user is already looking at the
  // ticket whose card is being rendered in the right-panel thread — instead
  // of bouncing them into the Chat ticket URL, flip the right panel to the
  // Details tab via a `?selectedTab=details` URL param. SupportTicketDetail
  // watches this param reactively.
  const isDeskView = location.pathname.includes('/support');

  const handleClick = (e: React.MouseEvent | KeyboardEvent): void => {
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
    } else if (resolvedChannelId && resolvedConversationId) {
      standaloneNavigate(navigate, `${baseRoute}/${resolvedChannelId}/${resolvedConversationId}`, {
        event,
      });
    }
  };

  return (
    <div
      className='w-full mt-2'
      data-track-category='CHAT_BUBBLE'
      data-track-name='OPEN_TICKET_FROM_BOT_BUBBLE'
    >
      <TicketCardV2 ticket={ticket} onClick={handleClick} isConversation={true} />
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
  messageId: _messageId,
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

  // Display existing ticket (md-only)
  if (renderTicketCard && ticketSummary && conversation?.initialMessageId === messageId) {
    return (
      <TicketDisplayModeV2
        ticket={ticketSummary}
        conversationContext={context}
        {...(channelId && { channelId: channelId })}
        {...(conversation && { conversationId: conversation.conversationId })}
      />
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
