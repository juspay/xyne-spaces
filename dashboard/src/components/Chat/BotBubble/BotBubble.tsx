import React, { ReactElement } from 'react';
import { TicketCard } from '../../Tickets/TicketCard/TicketCard';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import { useChannel } from '../../../hooks/useChannels';
import { createWorkflow, CreateWorkflowRequest } from '../../../services/Workflow/workflowService';

import { Ticket } from '@xyne/shared';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { standaloneNavigate } from '../../../utils/electronApp';
import { useNavigate } from 'react-router-dom';

interface BotBubbleProps {
  ticket?: Ticket;
  messageId?: string;
  messageContent?: string;
  channelId?: string;
  conversation?: ConversationWithTicket;
  isModalOpen?: boolean;
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

const TicketDisplayMode: React.FC<{
  ticket: Ticket;
  channelId?: string;
  conversationContext?: 'channel' | 'thread' | undefined;
  conversationId?: string;
}> = ({ ticket, channelId, conversationContext, conversationId }) => {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();

  const handleClick = (e?: React.MouseEvent<HTMLDivElement>): void => {
    if (conversationContext === 'channel') {
      standaloneNavigate(
        navigate,
        `${baseRoute}/${ticket.channelId}/${ticket.conversationId}/${ticket.id}?selectedTab=details`,
        { event: e },
      );
    } else if (conversationContext === 'thread') {
      standaloneNavigate(
        navigate,
        `${baseRoute}/${ticket.channelId}?tab=tickets&ticketId=${ticket.id}&conversationId=${ticket.conversationId}`,
        { event: e },
      );
    } else if (channelId && conversationId) {
      standaloneNavigate(navigate, `${baseRoute}/${channelId}/${conversationId}`, { event: e });
    }
  };

  return (
    <div className='w-full mt-2'>
      <TicketCard ticket={ticket} onClick={handleClick} isConversation={true} />
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

    // Workflow selection is now purely driven by user's choice from CreateTicketModal
    const workflowType: string | undefined = ticket.workflowType;

    // Only trigger workflow if one is selected
    if (workflowType) {
      // Base workflow data
      const workflowData: CreateWorkflowRequest = {
        title: '',
        workflowType,
        description: stripHtml(messageContent),
        ticketId: ticket.id,
        ...(ticket.conversationId && { conversationId: ticket.conversationId }),
        ...(ticket.xyneId && { xyneId: ticket.xyneId }),
      };

      // Add BUG_WORKFLOW specific required fields
      if (workflowType === 'BUG_WORKFLOW') {
        // For BUG_WORKFLOW, add required fields using ticket data
        const bugWorkflowData = {
          ...workflowData,
          bugId: ticket.id,
          severity: 'medium', // Default severity - can be enhanced later if needed
          reportedBy: ticket.createdBy || 'unknown',
          assignedTo: ticket.assignedTo || ticket.createdBy || 'unknown',
        };

        void createWorkflow(bugWorkflowData);
      } else {
        void createWorkflow(workflowData);
      }
    }

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
  ticket,
  messageId,
  messageContent = '',
  channelId,
  conversation,
  context,
  isModalOpen = false,
  onModalOpenChange,
  onTicketCreated,
}): ReactElement | null => {
  // Display existing ticket
  if (ticket && conversation?.initialMessageId === messageId) {
    return (
      <TicketDisplayMode
        ticket={ticket}
        conversationContext={context}
        {...(channelId && { channelId: channelId })}
        {...(conversation && { conversationId: conversation.conversationId })}
      />
    );
  }

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
