import { z } from 'zod';
import { AttachmentEntityType } from '@xyne/shared';
import { normalizeStoragePath } from '@xyne/storage';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import {
  AutomationTemplateAttachmentSchema,
  AUTOMATION_TEMPLATE_MAX_TOTAL_BYTES,
  prepareRenderedAutomationFiles,
} from '../services/automation-template.service';
import { repositories } from '@/database/repositories';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { storageService } from '@/services/storage';
import { extractEmailAddress } from '@/utils/email';
import { logger } from '@/utils/logger';
import type { OutgoingAttachment } from '@/integrations/core/baseMailReplySender';
import type { AutomationContext } from '../types/context';

/** The user's own Google grant, reused from call-recording recaps. */
export const PERSONAL_EMAIL_SOURCE_TYPE = 'google-recording-email';

/** True if any step, at any nesting depth, sends from the author's mailbox. */
export function usesPersonalMailbox(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(usesPersonalMailbox);
  if (!node || typeof node !== 'object') return false;
  const step = node as { type?: string; config?: { sendAs?: string } };
  if (step.type === 'SEND_EMAIL_TO_USER' && step.config?.sendAs === 'PERSONAL') return true;
  return Object.values(node).some(usesPersonalMailbox);
}

const SendEmailToUserConfigSchema = z.object({
  userId: variableRef(
    z.string().min(1).describe('Xyne user to email. Set exactly one of userId or toEmail.'),
  ).optional(),
  toEmail: variableRef(
    z.string().email().describe('Address to email when there is no Xyne user id. Set exactly one of userId or toEmail.'),
  ).optional(),
  subject: variableRef(z.string().min(1)),
  body: variableRef(z.string().min(1)),
  cc: z.array(variableRef(z.string().email())).optional(),
  bcc: z.array(variableRef(z.string().email())).optional(),
  sendAs: z
    .enum(['CHANNEL', 'PERSONAL'])
    .default('CHANNEL')
    .describe("CHANNEL uses the desk mailbox; PERSONAL uses the author's own Google account."),
  attachments: z.array(AutomationTemplateAttachmentSchema).max(10).optional(),
  // Points at a trigger array such as {{trigger.email.attachments}}. Only the id
  // is trusted: every other field is re-read from the database before sending.
  triggerAttachments: variableRef(
    z.array(z.object({ id: z.string().min(1) }).passthrough()).max(10),
  ).optional(),
});

const SendEmailToUserOutputSchema = z.object({
  delivered: z.boolean(),
  toEmail: z.string(),
});

interface SendEmailToUserOutput extends Record<string, unknown> {
  delivered: boolean;
  toEmail: string;
}

export class SendEmailToUserStep extends BaseActionStep<
  typeof SendEmailToUserConfigSchema,
  SendEmailToUserOutput
> {
  readonly type = 'SEND_EMAIL_TO_USER';
  readonly configSchema = SendEmailToUserConfigSchema;
  readonly outputSchema = SendEmailToUserOutputSchema;
  readonly name = 'Send email to user';
  readonly description =
    'Sends an email directly to a user\'s email address, from the workspace\'s connected email integration or from a person\'s own connected mailbox.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Mail';

  private externalSourceRepo = new ExternalSourceRepository();

  async execute(
    config: z.infer<typeof SendEmailToUserConfigSchema>,
    context: AutomationContext,
  ): Promise<SendEmailToUserOutput> {
    const userId = config.userId as string | undefined;
    const subject = config.subject as string;
    const body = config.body as string;
    const workspaceId = context.automation.workspaceId;

    if (!userId === !config.toEmail) {
      throw new Error('[SEND_EMAIL_TO_USER] Set exactly one of userId or toEmail (an unresolved {{ref}} counts as unset)');
    }

    let toEmail = config.toEmail as string;
    if (userId) {
      const user = await repositories.users.findById(userId);
      if (!user?.email) {
        throw new Error(`[SEND_EMAIL_TO_USER] User ${userId} not found or has no email`);
      }
      if (user.workspaceId !== workspaceId) {
        throw new Error(`[SEND_EMAIL_TO_USER] User ${userId} does not belong to workspace ${workspaceId}`);
      }
      toEmail = user.email;
    }

    let externalSource =
      config.sendAs === 'PERSONAL'
        ? await this.resolvePersonalSource(context)
        : await this.externalSourceRepo.findEmailSourceByWorkspaceId(workspaceId);

    if (!externalSource) {
      const trigger = context.trigger as { channel?: { id?: string } };
      const channelId = trigger.channel?.id;
      if (channelId) {
        const channelSource = await this.externalSourceRepo.findChannelSource(channelId, {
          sourceTypes: ['google', 'microsoft'],
        });
        if (channelSource && channelSource.workspaceId === workspaceId) {
          externalSource = channelSource;
        }
      }
    }

    if (!externalSource) {
      throw new Error(`[SEND_EMAIL_TO_USER] No active email integration found for workspace ${workspaceId}`);
    }

    let adapter: ReturnType<typeof adapterRegistry.getAdapter>;
    try {
      adapter = adapterRegistry.getAdapter(externalSource.name);
    } catch {
      throw new Error(`[SEND_EMAIL_TO_USER] Unknown email adapter: ${externalSource.name}`);
    }
    if (!adapter.sendMailNew) {
      throw new Error(`[SEND_EMAIL_TO_USER] Email provider ${externalSource.sourceType} does not support sending new mail`);
    }

    const fromEmail = extractEmailAddress(externalSource.displayName) || externalSource.displayName;
    // Outside the try below: a file that cannot be read must fail the step, not
    // be reported as a delivery failure.
    const fileAttachments = await this.collectAttachments(config, context);

    try {
      await adapter.sendMailNew({
        encryptedCredentials: externalSource.credentials,
        sourceId: externalSource.id,
        subject,
        body,
        to: [toEmail],
        cc: (config.cc as string[] | undefined) ?? [],
        bcc: (config.bcc as string[] | undefined) ?? [],
        ...(fromEmail && { fromEmailAddress: fromEmail }),
        ...(fileAttachments.length > 0 && { fileAttachments }),
      });
    } catch (error) {
      logger.error(
        `[automations] SEND_EMAIL_TO_USER delivery failed via ${externalSource.sourceType} source=${externalSource.id} workspace=${workspaceId}`,
        error,
      );
      return { delivered: false, toEmail };
    }

    logger.info(
      `[automations] SEND_EMAIL_TO_USER sent via ${externalSource.sourceType} source=${externalSource.id} workspace=${workspaceId}`,
    );

    return { delivered: true, toEmail };
  }

  /** Files uploaded on the step, plus any the trigger's email carried. */
  private async collectAttachments(
    config: z.infer<typeof SendEmailToUserConfigSchema>,
    context: AutomationContext,
  ): Promise<OutgoingAttachment[]> {
    const uploaded = await prepareRenderedAutomationFiles({
      attachments: config.attachments ?? [],
      context,
    });
    const files: OutgoingAttachment[] = [
      ...uploaded.map(file => ({
        name: file.originalName,
        contentType: file.mimeType,
        content: file.buffer,
      })),
      ...(await this.readTriggerAttachments(config, context)),
    ];
    // prepareRenderedAutomationFiles caps its own files; only the combined
    // total can still exceed what a provider will accept.
    const total = files.reduce((sum, file) => sum + file.content.length, 0);
    if (total > AUTOMATION_TEMPLATE_MAX_TOTAL_BYTES) {
      throw new Error('[SEND_EMAIL_TO_USER] Attachments exceed the 25MB total limit');
    }
    return files;
  }

  /** Files named by a trigger reference, re-read from the database by id. */
  private async readTriggerAttachments(
    config: z.infer<typeof SendEmailToUserConfigSchema>,
    context: AutomationContext,
  ): Promise<OutgoingAttachment[]> {
    const refs = config.triggerAttachments;
    if (!Array.isArray(refs) || refs.length === 0) return [];

    const workspaceId = context.automation.workspaceId;
    const rows = await repositories.messageAttachments.findByIds(refs.map(ref => ref.id));
    // findByIds filters on id alone, so an id from another workspace — or one
    // pointing at something that is not an email file — must be refused here.
    const usable = rows.filter(
      row =>
        row.workspaceId === workspaceId &&
        row.entityType === AttachmentEntityType.EMAIL &&
        !row.isDeleted,
    );
    if (usable.length !== refs.length) {
      throw new Error(
        `[SEND_EMAIL_TO_USER] ${refs.length - usable.length} of ${refs.length} trigger attachments are unavailable`,
      );
    }
    // Inbound mail carries no per-file cap of its own, so the recorded sizes are
    // checked before anything is pulled into memory.
    const total = usable.reduce((sum, row) => sum + row.size, 0);
    if (total > AUTOMATION_TEMPLATE_MAX_TOTAL_BYTES) {
      throw new Error('[SEND_EMAIL_TO_USER] Trigger attachments exceed the 25MB total limit');
    }

    return Promise.all(
      usable.map(async row => ({
        name: row.originalFilename,
        contentType: row.mimetype,
        content: await storageService.getFileBuffer(normalizeStoragePath(row.url)),
      })),
    );
  }

  /** The author's own mailbox. Throws rather than falling back to the desk inbox. */
  private async resolvePersonalSource(context: AutomationContext) {
    const workspaceId = context.automation.workspaceId;
    const senderUserId = context.automation.createdById;
    const source = await this.externalSourceRepo.findActiveByOwnerAndSourceType(
      senderUserId,
      PERSONAL_EMAIL_SOURCE_TYPE,
    );
    if (!source) {
      throw new Error(`[SEND_EMAIL_TO_USER] User ${senderUserId} has no connected Google account`);
    }
    // findActiveByOwnerAndSourceType filters on ownerUserId only, so without this
    // an automation could borrow a mailbox from another tenant.
    if (source.workspaceId !== workspaceId) {
      throw new Error(`[SEND_EMAIL_TO_USER] Personal mailbox of ${senderUserId} is not in workspace ${workspaceId}`);
    }
    return source;
  }
}

export const sendEmailToUserStep = new SendEmailToUserStep();
