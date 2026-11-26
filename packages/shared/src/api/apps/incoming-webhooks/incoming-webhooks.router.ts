import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsIncomingWebhooksCreate, appsIncomingWebhooksList, appsIncomingWebhooksRevoke, appsIncomingWebhooksUpdate } from './incoming-webhooks.contracts.js';

/** `/apps/incoming-webhooks`: managing an install's incoming webhooks (dashboard). Key order is the mount order. */
export const incomingWebhooksRouter = defineRouter('/incoming-webhooks', {
  create: appsIncomingWebhooksCreate,
  list: appsIncomingWebhooksList,
  update: appsIncomingWebhooksUpdate,
  revoke: appsIncomingWebhooksRevoke,
});
