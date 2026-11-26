import { Router } from 'express';
import { API } from '@xyne/shared';
import { ChannelController } from '../controllers/channelController';
import { ConversationController } from '../controllers/conversationController';
import { ShareAgentConversationController } from '../controllers/shareAgentConversationController';
import { uploadMultiple } from '../middleware/upload';
import { api } from '@/framework/api';
import {
  canLinkBoards,
  channelMembers,
  checkDuplicate,
  connectedEmail,
  emailAlias,
  memberCounts,
  publishTargets,
  searchForMentions,
  shareAgentStatus,
  vespaParticipants,
} from '@/handlers/channels';

// Typed routes (API.channels), served by the API router behind the contract gate: dashboard login,
// then the handler (which checks channel membership where the controller did).
api.routes(API.channels, (serve) => ({
  checkDuplicate: serve('checkDuplicate', { handle: ({ body, user }) => checkDuplicate({ body, user }) }),
  search: serve('search', { handle: ({ query, user }) => searchForMentions({ query, user }) }),
  memberCounts: serve('memberCounts', { handle: ({ body, user }) => memberCounts({ body, user }) }),
  publishTargets: serve('publishTargets', { handle: ({ user }) => publishTargets({ user }) }),
  connectedEmail: serve('connectedEmail', {
    responseHeaders: { 'Cache-Control': 'private, no-cache' },
    handle: ({ params, user }) => connectedEmail({ params, user }),
  }),
  emailAlias: serve('emailAlias', { handle: ({ params, user }) => emailAlias({ params, user }) }),
  vespaParticipants: serve('vespaParticipants', { handle: ({ params, user }) => vespaParticipants({ params, user }) }),
  members: serve('members', { handle: ({ params, user }) => channelMembers({ params, user }) }),
  canLinkBoards: serve('canLinkBoards', { handle: ({ params, user }) => canLinkBoards({ params, user }) }),
  shareAgentStatus: serve('shareAgentStatus', { handle: ({ params, query, user }) => shareAgentStatus({ params, query, user }) }),
}));

const router = Router();
const channelController = new ChannelController();
const conversationController = new ConversationController();
const shareAgentConversationController = new ShareAgentConversationController();

// Not moved yet: creating a channel, a conversation (file uploads) and sharing an agent conversation.
router.post('/', channelController.createChannel);

// Conversation Routes (nested under channels)
router.post('/:channelId/conversations', uploadMultiple, conversationController.createConversation);
router.post('/:channelId/share-agent-conversation', shareAgentConversationController.share);

export default router;
