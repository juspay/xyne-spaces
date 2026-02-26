import type { UserActivityEvent } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import { JsonValue } from '@prisma/client/runtime/library';

export interface ActivityWithRelatedData extends UserActivityEvent {
  relatedData: unknown;
}

export class UserActivityService {
  private prisma = DatabaseClient.getInstance();

  async _getMoreDetails(activity: UserActivityEvent): Promise<ActivityWithRelatedData> {
    let contextMetadata = (activity.contextMetadata as Record<string, unknown>) || {};

    let relatedData: unknown = {};
    if (contextMetadata.channelId && typeof contextMetadata.channelId === 'string') {
      
      if(!contextMetadata.channelName) {
        const channel = await repositories.channels.findById(contextMetadata.channelId);
        contextMetadata = { ...contextMetadata, channelName: channel?.name };
      }
    }

    if (contextMetadata.messageId && typeof contextMetadata.messageId === 'string') {
      const message = await repositories.messages.findById(contextMetadata.messageId);
      const user = await repositories.users.findById(message?.senderId || '');
      const conversationId = message?.conversationId;
      const [rd, ids] = conversationId ? await this.fetchConversationDetails(conversationId) : [{}, {}];
      relatedData = rd;
      contextMetadata = { ...contextMetadata, conversationId: conversationId, channelId: ids?.channelId, message: message?.content, sender: user?.name, createdAt: message?.createdAt };
    }

    if (contextMetadata.canvasId && typeof contextMetadata.canvasId === 'string') {
      const canvas = await this.prisma.canvas.findUnique({
        where: { id: contextMetadata.canvasId },
      });
      const channelId = canvas?.channelId;
      const channel = channelId ? await repositories.channels.findById(channelId) : {};
      relatedData = { channel: channel};
      const user = await repositories.users.findById(canvas?.createdBy || '');
      contextMetadata = { ...contextMetadata, title: canvas?.title, owner: user?.name };
    }

    if (contextMetadata.ticketId && typeof contextMetadata.ticketId === 'string') {
      const ticket = await repositories.tickets.getTicketById(contextMetadata.ticketId);
      const conversationId = ticket?.conversationId;
      const [rd, ids] = conversationId ? await this.fetchConversationDetails(conversationId) : [{}, {}];
      relatedData = rd;
      contextMetadata = { ...contextMetadata, title: ticket?.title, channelId: ids.channelId, conversationId: conversationId, description: ticket?.description, status: ticket?.status, assingnedTo: ticket?.assignedTo };
    }

    return {
      ...activity,
      relatedData: relatedData,
      contextMetadata: contextMetadata as unknown as JsonValue,
    };
  }

  async fetchConversationDetails(conversationId: string): Promise<[{
    ticket: { id: string; title: string; description: string; status: string; assignedTo: { id: string; name: string } | null } | null;
    messages: { id: string; content: string; sender: { id: string; name: string }; createdAt: Date }[];
    conversation: { id: string; channelId: string; createdBy: { id: string; name: string }; createdAt: Date; ticketId: string | null } | null;
  }, {conversationId: string, channelId: string}]> {
    const conversation = await repositories.conversations.findById(conversationId);

    if (!conversation) {
      return [{ ticket: null, messages: [], conversation: null }, {conversationId: '', channelId: ''}];
    }

    const [messages, ticket] = await Promise.all([
      repositories.messages.findMany({ conversationId }),
      conversation.ticketId ? repositories.tickets.getTicketById(conversation.ticketId) : null,
    ]);

    const userIds = new Set<string>([conversation.createdBy]);
    messages.forEach(m => userIds.add(m.senderId));
    if (ticket?.assignedTo) userIds.add(ticket.assignedTo);

    const users = await repositories.users.findMany({
      where: { id: { in: Array.from(userIds) } },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const messagesWithSender = messages.map(m => ({
      id: m.messageId,
      content: m.content,
      sender: {
        id: m.senderId,
        name: userMap.get(m.senderId)?.name || 'Unknown',
      },
      createdAt: m.createdAt,
    }));

    let ticketWithAssignee = null;
    if (ticket) {
      ticketWithAssignee = {
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.statusV2,
        assignedTo: ticket.assignedTo ? {
          id: ticket.assignedTo,
          name: userMap.get(ticket.assignedTo)?.name || 'Unknown',
        } : null,
      };
    }

    return [{
      ticket: ticketWithAssignee,
      messages: messagesWithSender,
      conversation: {
        id: conversation.conversationId,
        channelId: conversation.channelId,
        createdBy: {
          id: conversation.createdBy,
          name: userMap.get(conversation.createdBy)?.name || 'Unknown',
        },
        createdAt: conversation.createdAt,
        ticketId: conversation.ticketId,
      },
    }, {channelId: conversation.channelId, conversationId: conversation.conversationId}];
  }

  async resolveActivity(activity: UserActivityEvent): Promise<ActivityWithRelatedData> {
    return await this._getMoreDetails(activity);

    // switch(detailedActivity.eventName.toLocaleLowerCase()) {
    //   case 'REPLY_IN_THREAD':
    //   case 'OpenTicketCard':
    //   case 'OPEN_CHANNEL':
    //   case 'OPEN_CANVAS':

  }
}

export const userActivityService = new UserActivityService();
