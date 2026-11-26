import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { addReaction, getMessageReactions, getMessagesReactions, removeReaction, toggleReaction } from './reactions.controller';

/** The reactions of messages (`/reactions/bulk` before `/:messageId/...`). */
const reactionsRouter = api.router(API.messages.reactions, {}, (serve) => ({
  bulk: serve('bulk', { controller: ({ body, user }) => getMessagesReactions({ body, user }) }),
  add: serve('add', { controller: ({ params, body, user }) => addReaction({ params, body, user }) }),
  remove: serve('remove', { controller: ({ params, user }) => removeReaction({ params, user }) }),
  toggle: serve('toggle', { controller: ({ params, user }) => toggleReaction({ params, user }) }),
  get: serve('get', { controller: ({ params, user }) => getMessageReactions({ params, user }) }),
}));

/** `/messages`: message reactions (login). */
export const messagesRouter = api.router(API.messages, {}, () => ({
  reactions: reactionsRouter,
}));
