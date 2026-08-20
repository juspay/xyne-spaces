/**
 * Public API adapters for product operations that are intentionally outside
 * the Zero catalog: server-side allocation and multipart file uploads.
 */

import { z } from 'zod';
import { ChannelController } from '@/controllers/channelController';
import { ConversationController } from '@/controllers/conversationController';
import { TicketController } from '@/controllers/ticketController';
import { AttachmentController } from '@/controllers/attachmentController';
import { DraftAttachmentController } from '@/controllers/draftAttachmentController';
import { uploadMultiple } from '@/middleware/upload';
import type { RouteDefinition } from '../manifest/types';
import { callLegacyHandler } from './legacy-handler';

const channelController = new ChannelController();
const conversationController = new ConversationController();
const ticketController = new TicketController();
const attachmentController = new AttachmentController();
const draftAttachmentController = new DraftAttachmentController();

const channelIdParams = z.object({ channelId: z.string().min(1) });

/**
 * Request bodies for the non-catalog routes.
 *
 * These forward to legacy controllers that do their own validation, so these
 * schemas exist to *declare* the accepted field set rather than to police it —
 * every one is `.passthrough()`, which leaves runtime behaviour byte-identical
 * (zod would otherwise strip anything undeclared, and a field missed here would
 * silently stop reaching a controller that reads it).
 *
 * What they buy: the SDK's `contract-check` compares the arguments it sends
 * against these lists. Catalog operations already get that from their Zero zod
 * schemas; before this, the direct-API operations had nothing to check against,
 * which is how the SDK came to send three search parameters that did not exist.
 *
 * Field sets mirror what each controller reads from `req.body`. Every field is
 * optional: requiredness stays where the controllers already enforce it, so
 * nothing that used to reach a handler now fails at the edge instead.
 */
const createChannelBody = z
  .object({
    scopeType: z.string().optional(),
    projectId: z.string().optional(),
    scopeId: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    visibility: z.string().optional(),
    participants: z.array(z.string()).optional(),
    type: z.string().optional(),
    assigneeUserGroupId: z.string().optional(),
    deskType: z.string().optional(),
    dlEmail: z.string().optional(),
    slackChannelId: z.string().optional(),
    installedAppId: z.string().optional(),
    boardId: z.string().optional(),
  })
  .passthrough();

const checkDuplicateChannelBody = z
  .object({ name: z.string().optional(), projectId: z.string().optional() })
  .passthrough();

const createTicketBody = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    projectId: z.string().optional(),
    // Read later via `req.body.boardId` rather than the main destructure.
    boardId: z.string().optional(),
    id: z.string().optional(),
    channelId: z.string().optional(),
    sourceConversationId: z.string().optional(),
    assignedTo: z.string().optional(),
    userGroupId: z.string().optional(),
    statusV2: z.string().optional(),
    priority: z.string().optional(),
    eta: z.union([z.string(), z.number()]).optional(),
    metadata: z.unknown().optional(),
    closedAt: z.union([z.string(), z.number()]).optional(),
    closedBy: z.string().optional(),
    excludedChatAttachmentIds: z.array(z.string()).optional(),
    draftAttachmentIds: z.array(z.string()).optional(),
    dynamicFields: z.record(z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
    merchantId: z.string().optional(),
    parentTicketId: z.string().optional(),
    ticketType: z.string().optional(),
    stageName: z.string().optional(),
    fromTicketsTab: z.union([z.boolean(), z.string()]).optional(),
    fileMetadata: z.string().optional(),
  })
  .passthrough();

/** Multipart: multer parses the files, these are the accompanying text fields. */
const createConversationBody = z
  .object({
    content: z.string().optional(),
    msgType: z.string().optional(),
    visibleTo: z.string().optional(),
    fileMetadata: z.string().optional(),
  })
  .passthrough();

const uploadAttachmentsBody = z
  .object({
    entityId: z.string().optional(),
    entityType: z.string().optional(),
    attachmentIds: z.string().optional(),
    fileMetadata: z.string().optional(),
  })
  .passthrough();

const uploadDraftAttachmentsBody = z
  .object({
    channelId: z.string().optional(),
    conversationId: z.string().optional(),
    draftMessageId: z.string().optional(),
    attachmentIds: z.string().optional(),
    fileMetadata: z.string().optional(),
  })
  .passthrough();

export const catalogGapRoutes: readonly RouteDefinition[] = [
  {
    method: 'post',
    path: '/channels',
    operationId: 'createChannel',
    summary: 'Create a channel and its server-owned associated rows.',
    request: { body: createChannelBody },
    async handler(ctx) {
      return callLegacyHandler(channelController.createChannel, ctx);
    },
  },
  {
    method: 'post',
    path: '/channels/check-duplicate',
    operationId: 'checkDuplicateChannel',
    summary: 'Check whether a channel name is already in use.',
    request: { body: checkDuplicateChannelBody },
    async handler(ctx) {
      return callLegacyHandler(channelController.checkDuplicate, ctx);
    },
  },
  {
    method: 'post',
    path: '/tickets',
    operationId: 'createTicket',
    summary: 'Create a ticket using the project sequence allocator.',
    middleware: [uploadMultiple],
    request: { body: createTicketBody },
    async handler(ctx) {
      return callLegacyHandler(ticketController.createTicket, ctx, {
        body: normalizeMultipartJson(ctx.body, ['metadata', 'dynamicFields']),
      });
    },
  },
  {
    method: 'post',
    path: '/channels/:channelId/conversations',
    operationId: 'createConversationWithAttachments',
    summary: 'Start a conversation while uploading its attachments.',
    middleware: [uploadMultiple],
    request: { params: channelIdParams, body: createConversationBody },
    async handler(ctx) {
      return callLegacyHandler(conversationController.createConversation, ctx);
    },
  },
  {
    method: 'post',
    path: '/attachments',
    operationId: 'uploadAttachments',
    summary: 'Upload attachment bytes for an impact or form value.',
    middleware: [uploadMultiple],
    request: { body: uploadAttachmentsBody },
    async handler(ctx) {
      return callLegacyHandler(
        attachmentController.uploadAttachments.bind(attachmentController),
        ctx,
      );
    },
  },
  {
    method: 'post',
    path: '/draft-attachments',
    operationId: 'uploadDraftAttachments',
    summary: 'Upload attachment bytes and associate them with a draft.',
    middleware: [uploadMultiple],
    request: { body: uploadDraftAttachmentsBody },
    async handler(ctx) {
      return callLegacyHandler(
        draftAttachmentController.uploadDraftAttachment.bind(draftAttachmentController),
        ctx,
      );
    },
  },
];

function normalizeMultipartJson(body: unknown, fields: readonly string[]): unknown {
  if (!body || typeof body !== 'object') return body;
  const normalized = { ...(body as Record<string, unknown>) };
  for (const field of fields) {
    const value = normalized[field];
    if (typeof value !== 'string') continue;
    try {
      normalized[field] = JSON.parse(value);
    } catch {
      // The legacy controller owns validation and the eventual error response.
    }
  }
  return normalized;
}
