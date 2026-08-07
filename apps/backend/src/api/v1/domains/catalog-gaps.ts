/**
 * Public API adapters for product operations that are intentionally outside
 * the Zero catalog: server-side allocation and multipart file uploads.
 */

import { z } from 'zod';
import { readScope, writeScope } from '@xyne/spaces-contract';
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

export const catalogGapRoutes: readonly RouteDefinition[] = [
  {
    method: 'post',
    path: '/channels',
    operationId: 'createChannel',
    summary: 'Create a channel and its server-owned associated rows.',
    scope: writeScope('channels'),
    idempotency: 'optional',
    async handler(ctx) {
      return callLegacyHandler(channelController.createChannel, ctx);
    },
  },
  {
    method: 'post',
    path: '/channels/check-duplicate',
    operationId: 'checkDuplicateChannel',
    summary: 'Check whether a channel name is already in use.',
    scope: readScope('channels'),
    idempotency: 'optional',
    async handler(ctx) {
      return callLegacyHandler(channelController.checkDuplicate, ctx);
    },
  },
  {
    method: 'post',
    path: '/tickets',
    operationId: 'createTicket',
    summary: 'Create a ticket using the project sequence allocator.',
    scope: writeScope('tickets'),
    idempotency: 'optional',
    middleware: [uploadMultiple],
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
    scope: writeScope('conversations'),
    idempotency: 'optional',
    middleware: [uploadMultiple],
    request: { params: channelIdParams },
    async handler(ctx) {
      return callLegacyHandler(conversationController.createConversation, ctx);
    },
  },
  {
    method: 'post',
    path: '/attachments',
    operationId: 'uploadAttachments',
    summary: 'Upload attachment bytes for an impact or form value.',
    scope: writeScope('attachments'),
    idempotency: 'optional',
    middleware: [uploadMultiple],
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
    scope: writeScope('attachments'),
    idempotency: 'optional',
    middleware: [uploadMultiple],
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
