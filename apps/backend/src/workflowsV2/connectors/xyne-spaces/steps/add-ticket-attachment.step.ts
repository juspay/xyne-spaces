import {
  AttachmentSchema,
  BaseActionStep,
  markAttachmentFields,
  variableRef,
} from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { AttachmentEntityType } from '@xyne/shared';
import { z } from 'zod';
import { config as appConfig } from '@/config/env';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { TicketController } from '@/controllers/ticketController';
import { MAX_FILE_SIZE_BYTES, screenUploadBuffer } from '@/middleware/upload';
import { storageService } from '@/services/storage';
import { actorOf, workspaceOf } from '../context';

const AddTicketAttachmentConfigSchema = z.object({
  ticket: variableRef(z.string().min(1)).describe('Ticket id or ID like PLAT-12'),
  files: variableRef(z.array(AttachmentSchema).min(1)).describe(
    "Files to attach, such as a step's generated files"
  ),
});
type AddTicketAttachmentConfig = z.infer<typeof AddTicketAttachmentConfigSchema>;

const AddTicketAttachmentOutputSchema = z.object({
  ticketId: z.string(),
  xyneId: z.string(),
  attachments: z.array(
    z.object({
      attachmentId: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
      size: z.number(),
    })
  ),
});
type AddTicketAttachmentOutput = z.infer<typeof AddTicketAttachmentOutputSchema>;

// The executable and EICAR checks read only the start of a file.
const HEAD_BYTES = 64 * 1024;

const ticketController = new TicketController();

export class AddTicketAttachmentStep extends BaseActionStep<
  typeof AddTicketAttachmentConfigSchema,
  AddTicketAttachmentOutput
> {
  readonly type = 'ADD_TICKET_ATTACHMENT';
  readonly configSchema = AddTicketAttachmentConfigSchema;
  readonly outputSchema = AddTicketAttachmentOutputSchema;
  readonly name = 'Add attachment to ticket';
  readonly description =
    "Attaches files, such as a step's generated files, to a ticket. They show with the ticket's files.";
  readonly category = 'ticket';
  readonly icon = 'Paperclip';

  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    return markAttachmentFields(jsonSchema, ['files']);
  }

  async execute(
    config: AddTicketAttachmentConfig,
    ctx: StepExecutionContext
  ): Promise<AddTicketAttachmentOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const identifier = (config.ticket as string).trim();
    const files = config.files as z.infer<typeof AttachmentSchema>[];
    if (!ctx.files.available) throw new Error('This workflow cannot read files');

    const ticket = await db.ticket.findFirst({
      where: { workspaceId, OR: [{ id: identifier }, { xyneId: identifier }] },
      select: { id: true, xyneId: true, conversationId: true, channelId: true },
    });
    if (!ticket) throw new Error(`Ticket ${identifier} not found`);

    // Same checks as an upload in the app, all before anything is stored, so a refused file leaves
    // the ticket as it was.
    for (const file of files) {
      const info = await ctx.files.info(file);
      if (!info) throw new Error(`File ${file.name} not found`);
      if (info.size > MAX_FILE_SIZE_BYTES) throw new Error(`File ${file.name} is larger than 1 GB`);
      const chunks: Buffer[] = [];
      let read = 0;
      for await (const chunk of (await ctx.files.stream(file)) as AsyncIterable<Buffer | string>) {
        const bytes = Buffer.from(chunk);
        chunks.push(bytes);
        read += bytes.length;
        if (read >= HEAD_BYTES) break;
      }
      const verdict = await screenUploadBuffer(Buffer.concat(chunks), file.name, file.mimeType);
      if (!verdict.ok) throw new Error(`File ${file.name} was refused: ${verdict.reason}`);
    }

    const createdBy = await actorOf(ctx, this.type);
    const attachments: AddTicketAttachmentOutput['attachments'] = [];
    for (const file of files) {
      const uploadedAt = new Date().toISOString();
      const stored = await storageService.uploadStream(await ctx.files.stream(file), {
        filename: file.name,
        contentType: file.mimeType,
        metadata: { originalName: file.name, uploadedAt },
        scopeType: 'CONVERSATION',
        scopeId: 'temp',
      });
      const row = await repositories.messageAttachments.create({
        entityId: ticket.id,
        entityType: AttachmentEntityType.TICKET,
        originalFilename: file.name,
        size: stored.size,
        mimetype: file.mimeType,
        url: stored.path,
        uploadedByUserId: createdBy,
        createdBy,
        storageProvider: appConfig.fileStorage.provider,
        conversationId: ticket.conversationId,
        channelId: ticket.channelId,
        workspaceId,
        metadata: { uploadedAt, originalSize: stored.size, gcsPath: stored.path, proxied: false },
      });
      attachments.push({
        attachmentId: row.id,
        fileName: row.originalFilename,
        mimeType: row.mimetype,
        size: row.size,
      });
    }

    await ticketController.pushVespaJobForAttachments(
      attachments.map((attachment) => ({
        id: attachment.attachmentId,
        mimetype: attachment.mimeType,
      })),
      createdBy,
      workspaceId
    );

    return { ticketId: ticket.id, xyneId: ticket.xyneId, attachments };
  }
}
