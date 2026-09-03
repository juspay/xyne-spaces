import type { Request, Response } from 'express';
import { CallType, ChannelType, RecordingType } from '@xyne/shared';
import z from 'zod';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import type { OutgoingAttachment } from '@/integrations/core/baseMailReplySender';
import { callRecordingService } from '@/services/callRecordingService';
import { callShareService } from '@/services/callShareService';
import { canvasAuthService } from '@/services/canvasAuthService';
import {
  convertBlockNoteToMarkdown,
  resolveDetailedSummaryCanvasId,
} from '@/services/canvasService';
import { transcriptService } from '@/services/transcriptService';
import { normalizeStoragePath } from '@xyne/storage';
import { extractEmailAddress } from '@/utils/email';
import { readFromYSweet } from '@/utils/ysweetUtils';
import { logger } from '@/utils/logger';

const RECORDING_EMAIL_ATTACHMENT_KINDS = [
  'transcript',
  'recording',
  'notes',
  'detailed-summary',
] as const;

type RecordingEmailAttachmentKind = (typeof RECORDING_EMAIL_ATTACHMENT_KINDS)[number];
type RecordingCall = NonNullable<Awaited<ReturnType<typeof repositories.calls.findByExternalId>>>;

/** Recordings and regular calls share these endpoints, so copy names whichever it is. */
const subjectFor = (call: Pick<RecordingCall, 'callType'>): string =>
  call.callType === CallType.HEADLESS ? 'recording' : 'call';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_RECIPIENTS = 50;
const RECORDING_EMAIL_SOURCE_TYPE = 'google-recording-email';

const SendRecordingEmailSchema = z
  .object({
    to: z.array(z.string().trim().email()).min(1).max(MAX_RECIPIENTS),
    cc: z.array(z.string().trim().email()).max(MAX_RECIPIENTS).default([]),
    subject: z.string().trim().min(1).max(255),
    body: z.string().max(250_000).default(''),
    attachments: z.array(z.enum(RECORDING_EMAIL_ATTACHMENT_KINDS)).max(10).default([]),
  })
  .superRefine((value, ctx) => {
    if (!value.body.trim() && value.attachments.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Email body or at least one attachment is required',
        path: ['body'],
      });
    }
  });

interface RecordingEmailAttachmentDescriptor {
  kind: RecordingEmailAttachmentKind;
  label: string;
  filename: string;
  mimeType: string;
  detail: string;
}

interface RecordingEmailSender {
  channelId: string | null;
  sourceId: string;
  sourceName: string;
  encryptedCredentials: string;
  email: string;
  name: string;
}

class RecordingEmailError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'RecordingEmailError';
  }
}

const normalizedEmail = (value: string): string => value.trim().toLowerCase();

const normalizeRecipients = (recipients: readonly string[]): string[] => [
  ...new Set(recipients.map(normalizedEmail).filter(Boolean)),
];

const filenameStem = (value: string, fallback: string): string => {
  const sanitized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim();
  return sanitized || fallback;
};

const filenameFromStoragePath = (path: string, fallback: string): string =>
  path.split('/').filter(Boolean).pop() || fallback;

const metadataCanvasId = (
  metadata: unknown,
  key: 'notesCanvasId' | 'detailedSummaryCanvasId'
): string | null => {
  if (!metadata || typeof metadata !== 'object') return null;
  const source = metadata as Record<string, unknown>;
  const value =
    key === 'notesCanvasId'
      ? (source.notesCanvasId ?? source.notesCanvasViewAccessId)
      : source[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

const streamToBoundedBuffer = async (stream: NodeJS.ReadableStream): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      const destroyable = stream as NodeJS.ReadableStream & {
        destroy?: (reason?: Error) => void;
      };
      if (typeof destroyable.destroy === 'function') destroyable.destroy(error);
      reject(error);
    };

    stream.on('data', (chunk: Buffer | Uint8Array | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_ATTACHMENT_BYTES) {
        fail(
          new RecordingEmailError(
            'Recording attachment exceeds the 25MB email attachment limit. Remove it and share the recording link instead.',
            400
          )
        );
        return;
      }
      chunks.push(buffer);
    });
    stream.once('error', (error) =>
      fail(error instanceof Error ? error : new Error(String(error)))
    );
    stream.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });

/**
 * Sends recording recaps through a user's configured mailbox without creating
 * a Xyne Desk ticket. Desk's regular compose endpoint deliberately creates a
 * ticket, so recording sharing needs its own small transport boundary.
 */
export class RecordingEmailController {
  private async loadAccessibleRecording(req: Request): Promise<{
    call: RecordingCall;
    userId: string;
    workspaceId: string;
  }> {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const { callId } = req.params;

    if (!userId || !workspaceId) {
      throw new RecordingEmailError('Unauthorized', 401);
    }
    if (!callId) {
      throw new RecordingEmailError('Recording ID is required', 400);
    }

    const call = await repositories.calls.findByExternalId(callId);
    if (!call || (call.workspaceId !== null && call.workspaceId !== workspaceId)) {
      throw new RecordingEmailError('Recording not found', 404);
    }

    // Recordings and regular calls both come through here; canViewCall applies
    // whichever visibility rule the call's own type uses.
    const canView = await callShareService.canViewCall(call, userId, workspaceId);
    if (!canView) {
      throw new RecordingEmailError('Access denied', 403);
    }

    return { call, userId, workspaceId };
  }

  /** Resolve only an email account owned by, or matching, the current user. */
  private async resolveSender(
    workspaceId: string,
    userId: string
  ): Promise<{
    account: { name: string; email: string };
    sender: RecordingEmailSender | null;
  }> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, displayName: true, email: true },
    });
    if (!user) {
      throw new RecordingEmailError('User account not found', 401);
    }

    const account = {
      name: user.displayName?.trim() || user.name,
      email: normalizedEmail(user.email),
    };

    const personalSource = await db.externalSource.findFirst({
      where: {
        workspaceId,
        ownerUserId: userId,
        channelId: null,
        sourceType: RECORDING_EMAIL_SOURCE_TYPE,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        credentials: true,
      },
    });
    if (personalSource && extractEmailAddress(personalSource.displayName) === account.email) {
      try {
        const adapter = adapterRegistry.getAdapter(personalSource.name);
        if (adapter.sendMailNew) {
          return {
            account,
            sender: {
              channelId: null,
              sourceId: personalSource.id,
              sourceName: personalSource.name,
              encryptedCredentials: personalSource.credentials,
              email: account.email,
              name: account.name,
            },
          };
        }
      } catch {
      }
    }

    const emailChannels = await db.channel.findMany({
      where: {
        workspaceId,
        type: ChannelType.EMAIL,
      },
      select: { id: true },
    });
    const channelIds = emailChannels.map((channel) => channel.id);

    const [sources, preferences] = await Promise.all([
      db.externalSource.findMany({
        where: { channelId: { in: channelIds }, isActive: true },
        select: {
          id: true,
          name: true,
          channelId: true,
          displayName: true,
          ownerUserId: true,
          credentials: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      db.emailChannelPreference.findMany({
        where: { channelId: { in: channelIds } },
        select: { channelId: true, ownerUserId: true, sendAsEmail: true },
      }),
    ]);
    const preferenceByChannel = new Map(
      preferences.map((preference) => [preference.channelId, preference])
    );

    for (const source of sources) {
      if (!source.channelId) continue;
      const preference = preferenceByChannel.get(source.channelId);
      const senderEmail =
        extractEmailAddress(preference?.sendAsEmail) ??
        extractEmailAddress(source.displayName) ??
        account.email;
      const ownedByCurrentUser =
        source.ownerUserId === userId || preference?.ownerUserId === userId;
      const matchesAccount = senderEmail === account.email;
      if (!senderEmail || (!ownedByCurrentUser && !matchesAccount)) continue;

      try {
        const adapter = adapterRegistry.getAdapter(source.name);
        if (!adapter.sendMailNew) continue;
      } catch {
        continue;
      }

      return {
        account,
        sender: {
          channelId: source.channelId,
          sourceId: source.id,
          sourceName: source.name,
          encryptedCredentials: source.credentials,
          email: senderEmail,
          name: account.name,
        },
      };
    }

    const workspaceSources = await db.externalSource.findMany({
      where: {
        workspaceId,
        channelId: null,
        sourceType: { in: ['google', 'microsoft'] },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        credentials: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    for (const source of workspaceSources) {
      const senderEmail = extractEmailAddress(source.displayName);
      if (senderEmail !== account.email) continue;

      try {
        const adapter = adapterRegistry.getAdapter(source.name);
        if (!adapter.sendMailNew) continue;
      } catch {
        continue;
      }

      return {
        account,
        sender: {
          channelId: null,
          sourceId: source.id,
          sourceName: source.name,
          encryptedCredentials: source.credentials,
          email: senderEmail,
          name: account.name,
        },
      };
    }

    return { account, sender: null };
  }

  private async getCanvasDescriptor(
    canvasIdOrAccessId: string | null,
    workspaceId: string,
    userId: string,
    kind: 'notes' | 'detailed-summary'
  ): Promise<RecordingEmailAttachmentDescriptor | null> {
    const canvasId = await this.resolveAccessibleCanvasId(canvasIdOrAccessId, workspaceId, userId);
    if (!canvasId) return null;
    const canvas = await db.canvas.findFirst({
      where: { id: canvasId, workspaceId },
      select: { id: true, title: true },
    });
    if (!canvas) return null;

    const isNotes = kind === 'notes';
    return {
      kind,
      label: isNotes ? 'My notes' : 'Detailed summary',
      filename: `${filenameStem(canvas.title, isNotes ? 'my-notes' : 'detailed-summary')}.md`,
      mimeType: 'text/markdown',
      detail: 'Markdown',
    };
  }

  /** Resolve legacy canvas access IDs and ensure this user can view the export. */
  private async resolveAccessibleCanvasId(
    canvasIdOrAccessId: string | null,
    workspaceId: string,
    userId: string
  ): Promise<string | null> {
    if (!canvasIdOrAccessId) return null;

    const access = await canvasAuthService.checkCanvasAccess(canvasIdOrAccessId, userId);
    if (!access.canView || !access.canvas?.id) return null;

    const canvas = await db.canvas.findFirst({
      where: { id: access.canvas.id, workspaceId },
      select: { id: true },
    });
    return canvas?.id ?? null;
  }

  private async getAttachmentDescriptors(
    call: RecordingCall,
    workspaceId: string,
    userId: string
  ): Promise<RecordingEmailAttachmentDescriptor[]> {
    const descriptors: RecordingEmailAttachmentDescriptor[] = [];
    if (call.transcript) {
      descriptors.push({
        kind: 'transcript',
        label: 'Transcript',
        filename: `call_transcript_${call.externalId}.txt`,
        mimeType: 'text/plain',
        detail: 'Text',
      });
    }

    const latestRecording = await repositories.callRecordings
      .findLatestUploadedByCallId(call.id)
      .catch(() => null);
    if (latestRecording) {
      const storagePath = await callRecordingService.getStoragePathById(latestRecording.id);
      if (storagePath) {
        const isAudio = latestRecording.recordingType === RecordingType.AUDIO_ONLY;
        descriptors.push({
          kind: 'recording',
          label: isAudio ? 'Recording audio' : 'Recording video',
          filename: filenameFromStoragePath(storagePath, `recording-${latestRecording.id}.mp4`),
          mimeType: isAudio ? 'audio/mp4' : 'video/mp4',
          detail: isAudio ? 'Audio MP4' : 'Video MP4',
        });
      }
    }

    // Notes are a recordings-only canvas, so a regular call simply offers one
    // attachment fewer — metadataCanvasId returns null and the descriptor drops out.
    const metadata = call.metadata;
    const [notes, detailedSummary] = await Promise.all([
      this.getCanvasDescriptor(
        metadataCanvasId(metadata, 'notesCanvasId'),
        workspaceId,
        userId,
        'notes'
      ),
      this.getCanvasDescriptor(
        await resolveDetailedSummaryCanvasId(call),
        workspaceId,
        userId,
        'detailed-summary'
      ),
    ]);
    if (notes) descriptors.push(notes);
    if (detailedSummary) descriptors.push(detailedSummary);
    return descriptors;
  }

  private async buildCanvasAttachment(
    canvasIdOrAccessId: string | null,
    workspaceId: string,
    userId: string,
    fallbackTitle: string
  ): Promise<OutgoingAttachment> {
    const canvasId = await this.resolveAccessibleCanvasId(canvasIdOrAccessId, workspaceId, userId);
    if (!canvasId) {
      throw new RecordingEmailError('You no longer have access to this canvas attachment', 403);
    }
    const canvas = await db.canvas.findFirst({
      where: { id: canvasId, workspaceId },
      select: { id: true, title: true, content: true },
    });
    if (!canvas) {
      throw new RecordingEmailError('Canvas attachment is no longer available', 400);
    }

    const ySweetBlocks = await readFromYSweet(canvas.id, userId);
    const storedBlocks = Array.isArray(canvas.content) ? canvas.content : [];
    const markdown = await convertBlockNoteToMarkdown(
      ySweetBlocks.length > 0 ? ySweetBlocks : storedBlocks
    );
    const content = Buffer.from(
      `# ${canvas.title || fallbackTitle}\n\n${markdown}`.trimEnd() + '\n',
      'utf8'
    );
    if (content.length > MAX_ATTACHMENT_BYTES) {
      throw new RecordingEmailError(
        'Canvas attachment exceeds the 25MB email attachment limit',
        400
      );
    }

    return {
      name: `${filenameStem(canvas.title, fallbackTitle)}.md`,
      contentType: 'text/markdown',
      content,
    };
  }

  private async buildAttachments(
    call: RecordingCall,
    workspaceId: string,
    userId: string,
    selectedKinds: readonly RecordingEmailAttachmentKind[]
  ): Promise<OutgoingAttachment[]> {
    const selected = new Set(selectedKinds);
    const attachments: OutgoingAttachment[] = [];

    if (selected.has('transcript')) {
      if (!call.transcript) {
        throw new RecordingEmailError('Transcript attachment is no longer available', 400);
      }
      const transcript = await transcriptService.downloadFormattedTranscript(
        call.externalId,
        normalizeStoragePath(call.transcript)
      );
      if (!transcript) {
        throw new RecordingEmailError('Transcript attachment is no longer available', 400);
      }
      if (transcript.length > MAX_ATTACHMENT_BYTES) {
        throw new RecordingEmailError(
          'Transcript attachment exceeds the 25MB email attachment limit',
          400
        );
      }
      attachments.push({
        name: `call_transcript_${call.externalId}.txt`,
        contentType: 'text/plain',
        content: transcript,
      });
    }

    if (selected.has('recording')) {
      const latestRecording = await repositories.callRecordings.findLatestUploadedByCallId(call.id);
      if (!latestRecording) {
        throw new RecordingEmailError('Recording attachment is no longer available', 400);
      }
      const recording = await callRecordingService.streamRecordingById(latestRecording.id);
      if (!recording) {
        throw new RecordingEmailError('Recording attachment is no longer available', 400);
      }
      attachments.push({
        name: recording.filename,
        contentType:
          latestRecording.recordingType === RecordingType.AUDIO_ONLY ? 'audio/mp4' : 'video/mp4',
        content: await streamToBoundedBuffer(recording.stream),
      });
    }

    const metadata = call.metadata;
    if (selected.has('notes')) {
      attachments.push(
        await this.buildCanvasAttachment(
          metadataCanvasId(metadata, 'notesCanvasId'),
          workspaceId,
          userId,
          'my-notes'
        )
      );
    }
    if (selected.has('detailed-summary')) {
      attachments.push(
        await this.buildCanvasAttachment(
          await resolveDetailedSummaryCanvasId(call),
          workspaceId,
          userId,
          'detailed-summary'
        )
      );
    }

    const totalBytes = attachments.reduce(
      (sum, attachment) =>
        sum +
        (Buffer.isBuffer(attachment.content)
          ? attachment.content.length
          : Buffer.byteLength(attachment.content)),
      0
    );
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new RecordingEmailError(
        'Selected attachments exceed the 25MB email attachment limit. Remove a file and try again.',
        400
      );
    }

    return attachments;
  }

  getComposeContext = async (req: Request, res: Response): Promise<void> => {
    try {
      const { call, userId, workspaceId } = await this.loadAccessibleRecording(req);
      const [{ account, sender }, attachments] = await Promise.all([
        this.resolveSender(workspaceId, userId),
        this.getAttachmentDescriptors(call, workspaceId, userId),
      ]);

      res.json({
        from: sender
          ? { name: sender.name, email: sender.email }
          : { name: account.name, email: account.email },
        canSend: !!sender,
        ...(sender ? { channelId: sender.channelId } : { channelId: null }),
        ...(!sender
          ? {
              unavailableReason: `Connect an email account matching your Xyne account before sending ${subjectFor(
                call,
              )} recaps.`,
            }
          : {}),
        attachments,
      });
    } catch (error) {
      this.handleError(res, error, 'Failed to prepare recording email');
    }
  };

  sendRecordingEmail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { call, userId, workspaceId } = await this.loadAccessibleRecording(req);
      const input = SendRecordingEmailSchema.parse(req.body);
      const { sender } = await this.resolveSender(workspaceId, userId);
      if (!sender) {
        throw new RecordingEmailError(
          'No outbound email account matching your user account is connected',
          409
        );
      }

      const to = normalizeRecipients(input.to);
      const toSet = new Set(to);
      const cc = normalizeRecipients(input.cc).filter((email) => !toSet.has(email));
      const attachments = await this.buildAttachments(call, workspaceId, userId, input.attachments);

      const adapter = adapterRegistry.getAdapter(sender.sourceName);
      if (!adapter.sendMailNew) {
        throw new RecordingEmailError('The connected email provider cannot send new email', 400);
      }

      const result = await adapter.sendMailNew({
        encryptedCredentials: sender.encryptedCredentials,
        sourceId: sender.sourceId,
        subject: input.subject.trim(),
        body: input.body,
        to,
        cc,
        bcc: [],
        fromEmailAddress: sender.email,
        ...(attachments.length > 0 ? { fileAttachments: attachments } : {}),
      });

      logger.info('[RecordingEmail] sent', {
        callId: call.externalId,
        userId,
        sourceId: sender.sourceId,
        recipientCount: to.length + cc.length,
        attachmentKinds: input.attachments,
        externalMessageId: result.messageId ?? null,
      });
      res
        .status(200)
        .json({ success: true, messageId: result.messageId, threadId: result.threadId });
    } catch (error) {
      this.handleError(res, error, 'Failed to send recording email');
    }
  };

  private handleError(res: Response, error: unknown, fallback: string): void {
    if (error instanceof RecordingEmailError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid email request' });
      return;
    }
    logger.error(`[RecordingEmail] ${fallback}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: fallback });
  }
}

export const recordingEmailController = new RecordingEmailController();
