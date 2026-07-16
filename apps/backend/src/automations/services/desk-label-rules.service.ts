import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { AutomationStatus } from '../types/status';
import type { AutomationConfig } from '../types/automation-config';
import {
  EmailReceivedConfigFieldsSchema,
  hasEmailReceivedFilterConstraints,
  withEmailReceivedConfigValidation,
} from '../triggers/email-received.trigger';
import {
  DESK_AUTOMATION_WORKFLOW_TYPE,
  buildAutomationMetadata,
  parseAutomationMetadata,
  triggerTypeToEventType,
  workflowToAutomation,
  type AutomationView,
} from '../types/workflow-adapter';
import { automationService } from './automation.service';

export const DeskLabelRulesPayloadSchema = z.object({
  channelId: z.string().min(1),
  labelName: z.string().trim().min(1),
  color: z.string().optional(),
  labelId: z.string().optional(),
  name: z.string().trim().min(1).optional(),
  emailFilters: withEmailReceivedConfigValidation(
    EmailReceivedConfigFieldsSchema.omit({ channelIds: true }),
  ).optional(),
  keepInInbox: z.boolean().optional(),
});

export type DeskLabelRulesPayload = z.infer<typeof DeskLabelRulesPayloadSchema>;

function applyLabelStepConfig(params: {
  conversationIdVar: string;
  channelId: string;
  labelName: string;
  color?: string | undefined;
  labelId?: string | undefined;
  keepInInbox?: boolean | undefined;
}): Record<string, unknown> {
  return {
    conversationId: params.conversationIdVar,
    channelId: params.channelId,
    labelName: params.labelName,
    ...(params.color ? { color: params.color } : {}),
    ...(params.labelId ? { labelId: params.labelId } : {}),
    ...(params.keepInInbox === false ? { keepInInbox: false } : {}),
  };
}

function buildApplyLabelSteps(params: {
  conversationIdVar: string;
  channelId: string;
  labelName: string;
  color?: string | undefined;
  labelId?: string | undefined;
  keepInInbox?: boolean | undefined;
}): AutomationConfig['steps'] {
  return [
    {
      id: uuidv4(),
      type: 'APPLY_CONVERSATION_LABEL',
      config: applyLabelStepConfig(params),
    },
  ];
}

interface PendingDeskAutomation {
  name: string;
  description: string;
  config: AutomationConfig;
}

class DeskLabelRulesService {
  async create(
    payload: DeskLabelRulesPayload,
    auth: { userId: string; workspaceId: string },
  ): Promise<AutomationView[]> {
    const channel = await db.channel.findFirst({
      where: { id: payload.channelId, workspaceId: auth.workspaceId },
      select: { id: true, workspaceId: true, projectId: true },
    });
    if (!channel) {
      throw Object.assign(new Error('Channel not found'), { code: 'not-found' as const });
    }

    const isParticipant = await repositories.channelParticipants.isParticipant(
      payload.channelId,
      auth.userId,
    );
    if (!isParticipant) {
      throw Object.assign(new Error('You must be a member of this desk channel.'), {
        code: 'forbidden' as const,
      });
    }

    const wantEmail = hasEmailReceivedFilterConstraints(payload.emailFilters);
    if (!wantEmail) {
      throw Object.assign(
        new Error('Add at least one email filter before saving.'),
        { code: 'invalid' as const },
      );
    }

    const baseName = payload.name?.trim() || `Auto-label: ${payload.labelName}`;
    const pending: PendingDeskAutomation[] = [];

    if (wantEmail) {
      const emailFilters = { ...(payload.emailFilters ?? {}) };
      pending.push({
        name: baseName,
        description: `Desk auto-label for incoming email → ${payload.labelName}`,
        config: {
          trigger: {
            type: 'EMAIL_RECEIVED',
            config: {
              ...emailFilters,
              channelIds: [payload.channelId],
            },
          },
          steps: buildApplyLabelSteps({
            conversationIdVar: '{{context.trigger.email.conversationId}}',
            channelId: payload.channelId,
            labelName: payload.labelName,
            color: payload.color,
            labelId: payload.labelId,
            keepInInbox: payload.keepInInbox,
          }),
        },
      });
    }

    for (const item of pending) {
      const validation = automationService.validateConfig(item.config);
      if (!validation.valid) {
        const summary = validation.issues
          .slice(0, 3)
          .map(i => `${i.path}: ${i.message}`)
          .join('; ');
        throw Object.assign(new Error(`Invalid automation config: ${summary}`), {
          code: 'invalid' as const,
          validation,
        });
      }
    }

    const created = await db.$transaction(async tx => {
      const rows = [];
      for (const item of pending) {
        const id = uuidv4();
        const workflow = await tx.workflow.create({
          data: {
            id,
            workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
            workflowName: item.name,
            workspaceId: auth.workspaceId,
            status: AutomationStatus.ACTIVE,
            eventType: triggerTypeToEventType(item.config.trigger.type),
            automationSeriesId: id,
            context: JSON.stringify(item.config),
            metadata: buildAutomationMetadata({
              description: item.description,
              createdById: auth.userId,
            }),
          },
        });
        rows.push(workflow);
      }
      return rows;
    });

    logger.info(
      `[automations] desk-label-rules created count=${created.length} user=${auth.userId} channel=${payload.channelId}`,
    );
    return created.map(workflowToAutomation);
  }

  async listOwned(
    auth: { userId: string; workspaceId: string },
    channelId?: string,
  ): Promise<AutomationView[]> {
    // Owner/channel are filtered in memory from metadata + trigger config JSON.
    // At scale, add indexed ownership/channel/source columns or a companion table.
    const rows = await db.workflow.findMany({
      where: {
        workspaceId: auth.workspaceId,
        workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
        status: { in: [AutomationStatus.ACTIVE, AutomationStatus.DISABLED] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return rows
      .map(workflowToAutomation)
      .filter(a => a.createdById === auth.userId)
      .filter(a => {
        if (!channelId) return true;
        const channelIds = (a.config.trigger.config?.['channelIds'] as string[] | undefined) ?? [];
        return channelIds.includes(channelId);
      });
  }

  async setStatus(
    automationId: string,
    nextStatus: AutomationStatus.ACTIVE | AutomationStatus.DISABLED,
    auth: { userId: string; workspaceId: string },
  ): Promise<AutomationView> {
    await this.requireOwnedDeskRule(automationId, auth);
    const updated = await db.workflow.update({
      where: { id: automationId },
      data: { status: nextStatus, updatedAt: new Date() },
    });
    return workflowToAutomation(updated);
  }

  async archivePersonal(
    automationId: string,
    auth: { userId: string; workspaceId: string },
  ): Promise<AutomationView> {
    await this.requireOwnedDeskRule(automationId, auth, {
      allowArchived: false,
    });
    const updated = await db.workflow.update({
      where: { id: automationId },
      data: { status: AutomationStatus.ARCHIVED, updatedAt: new Date() },
    });
    return workflowToAutomation(updated);
  }

  private async requireOwnedDeskRule(
    automationId: string,
    auth: { userId: string; workspaceId: string },
    opts: { allowArchived?: boolean } = {},
  ) {
    const workflow = await db.workflow.findFirst({
      where: {
        id: automationId,
        workspaceId: auth.workspaceId,
        workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
        ...(opts.allowArchived ? {} : { status: { not: AutomationStatus.ARCHIVED } }),
      },
    });
    if (!workflow) {
      throw Object.assign(new Error('Automation not found'), { code: 'not-found' as const });
    }
    const metadata = parseAutomationMetadata(workflow.metadata);
    const isDesk = workflow.workflowType === DESK_AUTOMATION_WORKFLOW_TYPE
    if (!isDesk) {
      throw Object.assign(new Error('Only personal desk rules can be managed this way.'), {
        code: 'forbidden' as const,
      });
    }
    if (metadata.createdById !== auth.userId) {
      throw Object.assign(new Error('Only the owner can manage this rule.'), {
        code: 'forbidden' as const,
      });
    }
    return workflow;
  }
}

export const deskLabelRulesService = new DeskLabelRulesService();
