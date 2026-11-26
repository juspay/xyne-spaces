import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { addReaction, getMessageReactions, getMessagesReactions, removeReaction, toggleReaction } from '@/handlers/reactions';

// Typed routes (API.reactions), served by the API router behind the contract gate: dashboard login,
// then the handler.
api.routes(API.reactions, (serve) => ({
  bulk: serve('bulk', { handle: ({ body, user }) => getMessagesReactions({ body, user }) }),
  add: serve('add', { handle: ({ params, body, user }) => addReaction({ params, body, user }) }),
  remove: serve('remove', { handle: ({ params, user }) => removeReaction({ params, user }) }),
  toggle: serve('toggle', { handle: ({ params, user }) => toggleReaction({ params, user }) }),
  get: serve('get', { handle: ({ params, user }) => getMessageReactions({ params, user }) }),
}));

// Nothing untyped left under /api/messages.
const router = Router();
export default router;
