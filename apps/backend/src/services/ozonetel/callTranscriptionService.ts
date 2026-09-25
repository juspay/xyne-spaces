import { AttachmentEntityType } from '@xyne/shared';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { storageService } from '@/services/storage';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { telephonyEmailService } from './telephonyEmailService';
import {
  CALL_TRANSCRIPT_ATTACHMENT_TYPE,
  buildCallTranscriptFilename,
  findCallTranscriptAttachment,
  formatCallTranscript,
} from './callTranscript';
import {
  transcriptionAgentClient,
  TranscriptionAgentError,
  describeTranscriptionAgentError,
} from '@/services/transcriptionAgentClient';
import type { CallTranscriptionJobData } from '@/queues/callTranscriptionQueue';

const TAG = '[CallTranscriptionService]';

export type CallTranscriptionOutcome =
  | { status: 'done'; attachmentId: string }
  | { status: 'failed'; reason: string };

/**
 * Bull processor for the `call-transcription` queue.
 *
 * Flow: load the call email → ask the Python agent to download + transcribe the
 * Ozonetel recording → format → upload to the attachment bucket → create an EMAIL
 * attachment on the call email → write `transcription.status` into the email body.
 *
 * Failure semantics:
 * - Permanent (recording gone, unsupported media, bad URL, no recording): the job
 *   RETURNS `{status:'failed'}` after writing the failed state, so Bull does not
 *   retry. The user gets a Retry button.
 * - Transient (agent unreachable, 5xx, timeouts): the job THROWS so Bull retries
 *   with backoff; the state goes back to `queued` between attempts and to `failed`
 *   once attempts are exhausted (queue's `failed` listener).
 */
export class CallTranscriptionService {
  private readonly attachments = new MessageAttachmentRepository();

  async process(data: CallTranscriptionJobData, attempt: number, maxAttempts: number): Promise<CallTranscriptionOutcome> {
    const { emailId, workspaceId, userId } = data;
    const t0 = Date.now();
    logger.info(`${TAG} start | emailId=${emailId} | workspaceId=${workspaceId} | attempt=${attempt}/${maxAttempts}`);

    const email = await telephonyEmailService.getCallEmailWithPayload(emailId, workspaceId);
    if (!email) {
      return this.fail(data, 'Call not found.');
    }

    const recordingUrl = email.payload.recording?.trim();
    if (!recordingUrl) {
      return this.fail(data, 'This call has no recording to transcribe.');
    }

    // Idempotency: a retried job whose previous attempt got as far as the attachment.
    const existing = findCallTranscriptAttachment(
      await this.attachments.findByEntityIdAndType(emailId, AttachmentEntityType.EMAIL),
    );
    if (existing) {
      await telephonyEmailService.setTranscriptionState(emailId, workspaceId, {
        status: 'done',
        attachmentId: existing.id,
      });
      logger.info(`${TAG} transcript already exists | emailId=${emailId} | attachmentId=${existing.id}`);
      return { status: 'done', attachmentId: existing.id };
    }

    await telephonyEmailService.setTranscriptionState(emailId, workspaceId, { status: 'processing' });

    let result;
    try {
      result = await transcriptionAgentClient.transcribeRecording({
        jobId: emailId,
        recordingUrl,
      });
    } catch (error) {
      if (error instanceof TranscriptionAgentError && error.permanent) {
        logger.warn(`${TAG} permanent failure | emailId=${emailId} | code=${error.code} | ${error.message}`);
        return this.fail(data, describeTranscriptionAgentError(error));
      }
      const message = error instanceof TranscriptionAgentError ? describeTranscriptionAgentError(error) : String(error);
      if (attempt >= maxAttempts) {
        await this.safeSetState(data, { status: 'failed', error: message });
      } else {
        // Back in the queue until Bull's backoff fires; keep the UI honest.
        await this.safeSetState(data, { status: 'queued' });
      }
      logger.error(`${TAG} transient failure | emailId=${emailId} | attempt=${attempt}/${maxAttempts}:`, error);
      throw error;
    }

    const text = result.text.trim();
    if (!text) {
      return this.fail(data, 'No speech was detected in the recording.');
    }

    const content = formatCallTranscript(email.payload, { text, provider: result.provider });
    const buffer = Buffer.from(content, 'utf8');
    const filename = buildCallTranscriptFilename(email.payload, emailId);

    const uploaded = await storageService.uploadFile(buffer, {
      filename,
      contentType: 'text/plain; charset=utf-8',
      scopeType: 'EMAIL',
      scopeId: emailId,
      metadata: { type: CALL_TRANSCRIPT_ATTACHMENT_TYPE, emailId, workspaceId },
    });

    const attachment = await this.attachments.create({
      entityId: emailId,
      entityType: AttachmentEntityType.EMAIL,
      originalFilename: filename,
      size: buffer.length,
      mimetype: 'text/plain',
      url: uploaded.path,
      uploadedByUserId: userId,
      createdBy: userId,
      storageProvider: config.fileStorage.provider,
      conversationId: email.conversationId,
      workspaceId,
      metadata: { type: CALL_TRANSCRIPT_ATTACHMENT_TYPE, provider: result.provider },
    });

    await telephonyEmailService.setTranscriptionState(emailId, workspaceId, {
      status: 'done',
      attachmentId: attachment.id,
    });

    logger.info(
      `${TAG} done | emailId=${emailId} | attachmentId=${attachment.id} | bytes=${buffer.length}` +
        ` | provider=${result.provider} | elapsed=${Date.now() - t0}ms`,
    );
    return { status: 'done', attachmentId: attachment.id };
  }

  /** Called by the queue's `failed` listener once Bull has exhausted attempts. */
  async markFailed(data: CallTranscriptionJobData, message: string): Promise<void> {
    await this.safeSetState(data, { status: 'failed', error: truncate(message) });
  }

  private async fail(data: CallTranscriptionJobData, reason: string): Promise<CallTranscriptionOutcome> {
    await this.safeSetState(data, { status: 'failed', error: reason });
    return { status: 'failed', reason };
  }

  private async safeSetState(
    data: CallTranscriptionJobData,
    state: { status: 'queued' | 'processing' | 'done' | 'failed'; error?: string; attachmentId?: string },
  ): Promise<void> {
    try {
      await telephonyEmailService.setTranscriptionState(data.emailId, data.workspaceId, state);
    } catch (error) {
      logger.error(`${TAG} failed to write transcription state | emailId=${data.emailId} | status=${state.status}:`, error);
    }
  }
}

function truncate(message: string, max = 300): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export const callTranscriptionService = new CallTranscriptionService();
