import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsCallsGet, appsCallsSummaryTemplate, appsCallsSummaryTemplates } from './calls.contracts.js';

/** `/apps/calls`: calls, for bots (literal paths before `/:callId`). Key order is the mount order. */
export const callsRouter = defineRouter('/calls', {
  summaryTemplates: appsCallsSummaryTemplates,
  summaryTemplate: appsCallsSummaryTemplate,
  get: appsCallsGet,
});
