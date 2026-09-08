import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { extractEmailAddress } from '@/utils/email';
import { logger } from '@/utils/logger';
import type { AutomationContext } from '../types/context';

const SendEmailToUserConfigSchema = z.object({
  userId: variableRef(z.string().min(1)),
  subject: variableRef(z.string().min(1)),
  body: variableRef(z.string().min(1)),
  cc: z.array(variableRef(z.string().email())).optional(),
  bcc: z.array(variableRef(z.string().email())).optional(),
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
    'Sends an email directly to a user\'s email address using the workspace\'s connected email integration.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Mail';

  private externalSourceRepo = new ExternalSourceRepository();

  async execute(
    config: z.infer<typeof SendEmailToUserConfigSchema>,
    context: AutomationContext,
  ): Promise<SendEmailToUserOutput> {
    const userId = config.userId as string;
    const subject = config.subject as string;
    const body = config.body as string;
    const workspaceId = context.automation.workspaceId;

    const user = await repositories.users.findById(userId);
    if (!user?.email) {
      throw new Error(`[SEND_EMAIL_TO_USER] User ${userId} not found or has no email`);
    }
    if (user.workspaceId !== workspaceId) {
      throw new Error(`[SEND_EMAIL_TO_USER] User ${userId} does not belong to workspace ${workspaceId}`);
    }

    let externalSource = await this.externalSourceRepo.findEmailSourceByWorkspaceId(workspaceId);

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

    try {
      await adapter.sendMailNew({
        encryptedCredentials: externalSource.credentials,
        sourceId: externalSource.id,
        subject,
        body,
        to: [user.email],
        cc: (config.cc as string[] | undefined) ?? [],
        bcc: (config.bcc as string[] | undefined) ?? [],
        ...(fromEmail && { fromEmailAddress: fromEmail }),
      });
    } catch (error) {
      logger.error(
        `[automations] SEND_EMAIL_TO_USER delivery failed via ${externalSource.sourceType} source=${externalSource.id} workspace=${workspaceId}`,
        error,
      );
      return { delivered: false, toEmail: user.email };
    }

    logger.info(
      `[automations] SEND_EMAIL_TO_USER sent via ${externalSource.sourceType} source=${externalSource.id} workspace=${workspaceId}`,
    );

    return { delivered: true, toEmail: user.email };
  }
}

export const sendEmailToUserStep = new SendEmailToUserStep();
