import { api, AccessType } from '@xyne/shared';
import { router } from '@/framework/api';
import { createIncomingWebhook, listIncomingWebhooks, revokeIncomingWebhook, updateIncomingWebhook } from './incoming-webhooks.controller';
import { xyneApps } from '@/api/apps/xyne-apps.access';

/** `/apps/incoming-webhooks`: managing an install's incoming webhooks (dashboard login + XYNE-APPS access). */
export const incomingWebhooksRouter = router(api.apps.incomingWebhooks, {}, (serve) => ({

  create: serve('create', {
    ...xyneApps(AccessType.WRITE),
    successStatus: 201,
    controller: ({ body, user }) => createIncomingWebhook({ body, user }),
  }),
  list: serve('list', {
    ...xyneApps(AccessType.READ),
    controller: ({ params, query, user }) => listIncomingWebhooks({ params, query, user }),
  }),
  update: serve('update', {
    ...xyneApps(AccessType.WRITE),
    controller: ({ params, body, user }) => updateIncomingWebhook({ params, body, user }),
  }),
  revoke: serve('revoke', {
    ...xyneApps(AccessType.WRITE),
    controller: ({ params, user }) => revokeIncomingWebhook({ params, user }),
  }),
}));
