import { z } from 'zod';
import { defineRoute } from '../../../enc-contracts/api-route.js';

// ─── Xyne Apps calls and ticket metadata (/apps/calls, /apps/ticket), bot token ──
// Reads only: ids, names, settings and call/ticket metadata; nothing encrypted. Rules are the
// controllers' own (AppCallController, TicketController), moved here.

/** GET /apps/calls/:callId: call detail and participants (`:callId` is Call.externalId). */
export const appsCallsGet = defineRoute({
  method: 'GET',
  path: '/:callId',
  params: z.object({ callId: z.string().min(1, 'callId is required') }),
  response: z.object({
    success: z.literal(true),
    call: z.object({
      callId: z.string(),
      title: z.string().nullable(),
      description: z.string().nullable(),
      status: z.string(),
      callType: z.string(),
      callOrigin: z.string(),
      channelId: z.string().nullable(),
      createdByUserId: z.string(),
      organizerId: z.string().nullable(),
      roomLink: z.string().nullable(),
      scheduledStartsAt: z.string().nullable(),
      scheduledEndsAt: z.string().nullable(),
      timezone: z.string(),
      startedAt: z.string(),
      endedAt: z.string().nullable(),
      durationSeconds: z.number().nullable(),
      summaryTemplateId: z.string().nullable(),
      hasTranscript: z.boolean(),
      summaryStatus: z.string().nullable(),
      detailedSummaryCanvasId: z.string().nullable(),
      participants: z.array(
        z.object({
          joinedAt: z.string().nullable(),
          leftAt: z.string().nullable(),
          userId: z.string().nullable(),
          name: z.string(),
          email: z.string().nullable(),
          isExternal: z.boolean(),
        }),
      ),
    }),
  }),
});

/** GET /apps/calls/summary-templates: summary rows of every template visible to the app's user. */
export const appsCallsSummaryTemplates = defineRoute({
  method: 'GET',
  path: '/summary-templates',
  response: z.object({
    success: z.literal(true),
    templates: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        visibility: z.string(),
        defaultOutlet: z.string(),
        version: z.number(),
        sectionCount: z.number(),
        createdBy: z.string(),
        createdAt: z.union([z.date(), z.string()]),
        canEdit: z.boolean(),
        isSystem: z.boolean(),
      }),
    ),
  }),
});

/** GET /apps/calls/summary-templates/:templateId: one template in full. */
export const appsCallsSummaryTemplate = defineRoute({
  method: 'GET',
  path: '/summary-templates/:templateId',
  params: z.object({ templateId: z.string().min(1) }),
  response: z.object({
    success: z.literal(true),
    template: z.object({
      id: z.string(),
      name: z.string(),
      workspaceId: z.string(),
      visibility: z.string(),
      autoTriggerPrompt: z.string().nullable(),
      // The sections are the template's own JSON document (any shape), so they stay open.
      sections: z.unknown(),
      version: z.number(),
      systemPrompt: z.string(),
      defaultOutlet: z.string(),
      createdBy: z.string(),
      createdAt: z.union([z.date(), z.string()]),
    }),
  }),
});