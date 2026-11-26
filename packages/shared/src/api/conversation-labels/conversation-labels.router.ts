import { defineRouter } from '../../enc-contracts/api-route.js';
import { conversationLabelsDelete, conversationLabelsDeleteImpact, conversationLabelsUnreadCount, conversationLabelsUnreadCounts } from './conversation-labels.contracts.js';

/** `/conversation-labels`: label counts and deletion. Key order is the mount order. */
export const conversationLabelsRouter = defineRouter('/conversation-labels', {
  unreadCounts: conversationLabelsUnreadCounts,
  unreadCount: conversationLabelsUnreadCount,
  deleteImpact: conversationLabelsDeleteImpact,
  delete: conversationLabelsDelete,
});
