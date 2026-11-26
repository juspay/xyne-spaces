import { z } from 'zod';
import { defineRoute } from '../../enc-contracts/api-route.js';
import { TicketPriority } from '../../zero/types.js';

// ── Conversation labels (/conversation-labels/...) ──────────────────────────

const labelImpact = z.object({
  label: z.object({ id: z.string(), name: z.string(), channelId: z.string() }),
  mappingCount: z.number(),
  linkedDeskRuleCount: z.number(),
});
const labelDeleteResult = labelImpact.extend({ archivedDeskRuleCount: z.number(), removedMappingCount: z.number() });
const labelsOk = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data, timestamp: z.string() });

export const conversationLabelsUnreadCounts = defineRoute({
  method: 'GET',
  path: '/unread-counts',
  query: z.object({ channelId: z.string().min(1, 'channelId query param is required') }),
  response: labelsOk(z.object({ counts: z.record(z.string(), z.number()) })),
});

const unreadCountsFilters = z.object({
  assignedTo: z.array(z.string()).optional(),
  createdBy: z.array(z.string()).optional(),
  priority: z.array(z.nativeEnum(TicketPriority)).optional(),
  stageName: z.array(z.string()).optional(),
  aiCategory: z.array(z.string()).optional(),
  conversationIds: z.array(z.string()).optional(),
  hasAiDraft: z.boolean().optional(),
  hasSubTickets: z.boolean().optional(),
  userGroups: z.array(z.string()).optional(),
  lastEmailAtStart: z.number().optional(),
  lastEmailAtEnd: z.number().optional(),
  createdAtStart: z.number().optional(),
  createdAtEnd: z.number().optional(),
  dynamicFieldFilters: z
    .array(
      z.object({
        fieldId: z.string(),
        values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
        fieldType: z.string().optional(),
        dateRange: z.object({ start: z.number().optional(), end: z.number().optional() }).optional(),
      }),
    )
    .optional(),
});

export const conversationLabelsUnreadCount = defineRoute({
  method: 'POST',
  path: '/unread-counts',
  body: z.object({ channelId: z.string(), labelId: z.string(), filters: unreadCountsFilters.optional() }),
  response: labelsOk(z.object({ labelId: z.string(), unreadCount: z.number() })),
});

export const conversationLabelsDeleteImpact = defineRoute({
  method: 'GET',
  path: '/:labelId/delete-impact',
  params: z.object({ labelId: z.string().min(1) }),
  response: labelsOk(labelImpact),
});

export const conversationLabelsDelete = defineRoute({
  method: 'DELETE',
  path: '/:labelId',
  params: z.object({ labelId: z.string().min(1) }),
  response: labelsOk(labelDeleteResult),
});