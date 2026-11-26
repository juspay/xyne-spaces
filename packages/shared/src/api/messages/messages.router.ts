import { defineRouter } from '../../enc-contracts/api-route.js';
import { reactionsAdd, reactionsBulk, reactionsGet, reactionsRemove, reactionsToggle } from './reactions.contracts.js';

/** `/messages`: message reactions (`/reactions/bulk` before `/:messageId/...`). Key order is the mount order. */
export const messagesRouter = defineRouter('/messages', {
  reactions: defineRouter('', {
    bulk: reactionsBulk,
    add: reactionsAdd,
    remove: reactionsRemove,
    toggle: reactionsToggle,
    get: reactionsGet,
  }),
});
