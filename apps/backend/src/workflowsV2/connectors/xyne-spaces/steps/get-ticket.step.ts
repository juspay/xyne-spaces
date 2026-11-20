import type { Readable } from 'node:stream';
import {
  ATTACHMENT_ARRAY_JSON_SCHEMA,
  AttachmentSchema,
  BaseActionStep,
  variableRef,
  zodToJsonSchemaRecord,
} from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { AttachmentEntityType } from '@xyne/shared';
import { z } from 'zod';
import { db } from '@/database/client';
import { storageService } from '@/services/storage';
import { logger } from '@/utils/logger';
import { workspaceOf } from '../context';

const GetTicketConfigSchema = z.object({
  ticket: variableRef(z.string().min(1)).describe('Ticket id or ID like PLAT-12'),
  includeAttachments: z
    .boolean()
    .optional()
    .describe("Also return the ticket's attached files, copied so later steps can use them"),
});
type GetTicketConfig = z.infer<typeof GetTicketConfigSchema>;

const SubTicketSchema = z.object({
  subTicketId: z.string().describe('The sub-ticket row; what release dev tickets and changes attach to'),
  title: z.string(),
  ticketId: z.string().nullable().describe('The ticket the sub-ticket points to; null when it points to none'),
  xyneId: z.string().nullable(),
  boardId: z.string().nullable(),
  stageName: z.string().nullable(),
  status: z.string().nullable(),
});

const GetTicketOutputSchema = z.object({
  id: z.string(),
  xyneId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  boardId: z.string(),
  projectId: z.string(),
  channelId: z.string(),
  conversationId: z.string(),
  stageName: z.string().nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  ticketType: z.string().nullable(),
  assignedTo: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  subTickets: z.array(SubTicketSchema),
  attachments: z
    .array(
      z.object({
        attachmentId: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
        size: z.number(),
        uploadedAt: z.string(),
        copied: z.boolean().describe('False when the file is over 50 MB or could not be read, so it is not in files'),
      }),
    )
    .optional()
    .describe('Set when includeAttachments is on'),
  files: z
    .array(AttachmentSchema)
    .optional()
    .describe('The attached files, for steps that take files. Set when includeAttachments is on'),
});
type GetTicketOutput = z.infer<typeof GetTicketOutputSchema>;

// Copying is a full read and write of each file, so very large ones (recordings, videos) are left out.
const MAX_COPY_BYTES = 50 * 1024 * 1024;

export class GetTicketStep extends BaseActionStep<typeof GetTicketConfigSchema, GetTicketOutput> {
  readonly type = 'GET_TICKET';
  readonly configSchema = GetTicketConfigSchema;
  readonly outputSchema = GetTicketOutputSchema;
  readonly name = 'Get a ticket';
  readonly description = "Reads a ticket's details and its sub-tickets, and optionally its attached files.";
  readonly category = 'ticket';
  readonly icon = 'Ticket';

  override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
    const schema = zodToJsonSchemaRecord(this.outputSchema);
    const properties = { ...(schema['properties'] as Record<string, unknown>) };
    if (config['includeAttachments'] === true) {
      properties['files'] = ATTACHMENT_ARRAY_JSON_SCHEMA;
    } else {
      delete properties['attachments'];
      delete properties['files'];
    }
    return { ...schema, properties };
  }

  async execute(config: GetTicketConfig, ctx: StepExecutionContext): Promise<GetTicketOutput> {
    const identifier = (config.ticket as string).trim();
    const ticket = await db.ticket.findFirst({
      where: { workspaceId: workspaceOf(ctx, this.type), OR: [{ id: identifier }, { xyneId: identifier }] },
    });
    if (!ticket) throw new Error(`Ticket ${identifier} not found`);

    const mappings = await db.ticketSubTicketMapping.findMany({
      where: { ticketId: ticket.id },
      select: {
        subTicket: {
          select: {
            id: true,
            title: true,
            mappedTicket: { select: { id: true, xyneId: true, boardId: true, stageName: true, statusV2: true } },
          },
        },
      },
    });

    const attached = config.includeAttachments
      ? await db.messageAttachment.findMany({
          where: { entityType: AttachmentEntityType.TICKET, entityId: ticket.id, isDeleted: false },
          orderBy: { createdAt: 'asc' },
          select: { id: true, originalFilename: true, mimetype: true, size: true, url: true, createdAt: true },
        })
      : [];
    const attachments: NonNullable<GetTicketOutput['attachments']> = [];
    const files: NonNullable<GetTicketOutput['files']> = [];
    for (const row of attached) {
      let copied = false;
      if (ctx.files.available && row.size <= MAX_COPY_BYTES) {
        try {
          const stream = (await storageService.createReadStream(row.url)) as Readable;
          files.push(await ctx.files.put({ name: row.originalFilename, mimeType: row.mimetype, stream }));
          copied = true;
        } catch (error) {
          logger.warn(`[GET_TICKET] Could not copy attachment ${row.id} of ticket ${ticket.xyneId}:`, error);
        }
      }
      attachments.push({
        attachmentId: row.id,
        fileName: row.originalFilename,
        mimeType: row.mimetype,
        size: row.size,
        uploadedAt: row.createdAt.toISOString(),
        copied,
      });
    }

    return {
      ...(config.includeAttachments ? { attachments, files } : {}),
      id: ticket.id,
      xyneId: ticket.xyneId,
      title: ticket.title,
      description: ticket.description,
      boardId: ticket.boardId,
      projectId: ticket.projectId,
      channelId: ticket.channelId,
      conversationId: ticket.conversationId,
      stageName: ticket.stageName,
      status: ticket.statusV2,
      priority: ticket.priority,
      ticketType: ticket.ticketType,
      assignedTo: ticket.assignedTo,
      createdBy: ticket.createdBy,
      createdAt: ticket.createdAt.toISOString(),
      subTickets: mappings.map(({ subTicket }) => ({
        subTicketId: subTicket.id,
        title: subTicket.title,
        ticketId: subTicket.mappedTicket?.id ?? null,
        xyneId: subTicket.mappedTicket?.xyneId ?? null,
        boardId: subTicket.mappedTicket?.boardId ?? null,
        stageName: subTicket.mappedTicket?.stageName ?? null,
        status: subTicket.mappedTicket?.statusV2 ?? null,
      })),
    };
  }
}
