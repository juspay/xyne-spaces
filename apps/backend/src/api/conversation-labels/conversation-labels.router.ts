import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { labelDelete, labelDeleteImpact, labelUnreadCount, labelUnreadCounts } from './conversation-labels.controller';

/** `/conversation-labels` (login). */
export const conversationLabelsRouter = router(api.conversationLabels, {}, (serve) => ({
  unreadCounts: serve('unreadCounts', { controller: ({ query, user }) => labelUnreadCounts({ query, user }) }),
  unreadCount: serve('unreadCount', { controller: ({ body, user }) => labelUnreadCount({ body, user }) }),
  deleteImpact: serve('deleteImpact', { controller: ({ params, user }) => labelDeleteImpact({ params, user }) }),
  delete: serve('delete', { controller: ({ params, user }) => labelDelete({ params, user }) }),
}));
