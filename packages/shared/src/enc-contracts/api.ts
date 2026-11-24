import { replyToConversationClient } from './contracts/conversations.js';

/**
 * Every HTTP API that has a contract, grouped by the backend router that serves it. This is
 * the list of what the backend may serve: `serveApi(router, API.<group>, routes)` registers
 * exactly the entries of a group and takes one route per entry, so a route with no entry here
 * does not compile, and neither does an entry with no route. Method and path are the
 * backend's (they are given where the group is served).
 */
export const API = {
  conversations: {
    replyToConversation: replyToConversationClient,
  },
} as const;
