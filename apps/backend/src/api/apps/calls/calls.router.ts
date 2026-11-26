import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { getCall, getSummaryTemplate, listSummaryTemplates } from './calls.controller';
import { appPermission } from '@/apps/access';

/** `/apps/calls` (bot token). */
export const callsRouter = api.router(API.apps.calls, { auth: 'app' }, (serve) => ({
  summaryTemplates: serve('summaryTemplates', {
    access: { permission: appPermission('summaries:read') },
    controller: ({ user }) => listSummaryTemplates({ user }),
  }),
  summaryTemplate: serve('summaryTemplate', {
    access: { permission: appPermission('summaries:read') },
    controller: ({ params, user }) => getSummaryTemplate({ params, user }),
  }),
  get: serve('get', {
    access: { permission: appPermission('calls:read') },
    controller: ({ params, user }) => getCall({ params, user }),
  }),
}));
