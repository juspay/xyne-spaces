import { z } from 'zod';
import { defineRoute } from '../api-route.js';
import { TicketPriority } from '../../zero/types.js';

// ─── CAC config, sub-ticket links and conversation labels: dashboard login. ─────────────
// Ids, keys, counts and flags. Nothing encrypted.

// ── CAC config (/cac-config/:key) ───────────────────────────────────────────

/** One config value by key, resolved for the caller (their email, workspace, and the playground header). */
export const cacConfigGet = defineRoute({
  method: 'GET',
  path: '/cac-config/:key',
  params: z.object({ key: z.string().min(1, 'Config key is required') }),
  response: z.object({ key: z.string(), config: z.unknown() }),
});

// ── Sub-tickets (/sub-tickets/...) ──────────────────────────────────────────

const requiredId = (message: string) => z.string().refine((value) => value.trim().length > 0, message);

export const subTicketsLink = defineRoute({
  method: 'POST',
  path: '/sub-tickets/link',
  body: z.object({
    ticketId: requiredId('ticketId is required'),
    mappedTicketId: requiredId('mappedTicketId is required'),
    subTicketTitle: z.unknown().optional(),
  }),
  response: z.object({ subTicketId: z.string(), mappingId: z.string() }),
});

export const subTicketsUnlink = defineRoute({
  method: 'POST',
  path: '/sub-tickets/unlink',
  body: z.object({ mappingId: requiredId('mappingId is required') }),
  response: z.null(),
});

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
  path: '/conversation-labels/unread-counts',
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
  path: '/conversation-labels/unread-counts',
  body: z.object({ channelId: z.string(), labelId: z.string(), filters: unreadCountsFilters.optional() }),
  response: labelsOk(z.object({ labelId: z.string(), unreadCount: z.number() })),
});

export const conversationLabelsDeleteImpact = defineRoute({
  method: 'GET',
  path: '/conversation-labels/:labelId/delete-impact',
  params: z.object({ labelId: z.string().min(1) }),
  response: labelsOk(labelImpact),
});

export const conversationLabelsDelete = defineRoute({
  method: 'DELETE',
  path: '/conversation-labels/:labelId',
  params: z.object({ labelId: z.string().min(1) }),
  response: labelsOk(labelDeleteResult),
});
