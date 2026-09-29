import { db } from '@/database/client';
import { v4 as uuidv4 } from 'uuid';
import { DESK_AUTOMATION_WORKFLOW_TYPE, triggerTypeToEventType, buildAutomationMetadata, workflowToAutomation } from '@/automations/types/workflow-adapter';
import { AutomationStatus } from '@/automations/types/status';
import { logger } from '@/utils/logger';
import { DeskLabelRulesService, DeskLabelRulesCreateResult, workflowToSingleResult, ResolvedConversationLabel, serviceError } from '@/automations/services/desk-label-rules.service';
import { transaction } from '../base';
import type { AutomationConfig } from '@/automations/types/automation-config';
import { Prisma, Workflow } from '@prisma/client';
import type { DeskLabelRulesPayload } from '@/automations/services/desk-label-rules.service';
export function createRuleTx2(self: DeskLabelRulesService, auth: { userId: string; workspaceId: string; }, payload: { channelId: string; labelName: string; color?: string | undefined; labelId?: string | undefined; name?: string | undefined; emailFilters?: { fromEmails?: string[] | undefined; fromDomains?: string[] | undefined; toEmails?: string[] | undefined; subjectContains?: string[] | undefined; bodyContains?: string[] | undefined; matchCase?: boolean | undefined; excludedFromEmails?: string[] | undefined; excludedFromDomains?: string[] | undefined; excludedToEmails?: string[] | undefined; excludedSubjectContains?: string[] | undefined; excludedBodyContains?: string[] | undefined; onlyNewThreads?: boolean | undefined; hasAttachments?: boolean | undefined; onlyReplies?: boolean | undefined; } | undefined; keepInInbox?: boolean | undefined; applyToExisting?: boolean | undefined; }, label: ResolvedConversationLabel, filterFingerprint: string, name: string, config: AutomationConfig) {
  return transaction(['DeskAutoLabelRuleReference', 'Workflow'], 'createRule: existing desk workflow lookup plus restore must commit atomically; tx is not ACL-wrapped', db, tx =>
    findOrRestoreExistingDeskWorkflow(self, tx, {
      auth,
      channelId: payload.channelId,
      label,
      filterFingerprint,
      name,
      config,
    }),
  );
}
export function archivePersonalTx(self: DeskLabelRulesService, automationId: string, auth: { userId: string; workspaceId: string; }) {
  return transaction(['DeskAutoLabelRuleReference', 'Workflow'], 'archivePersonal: owned-rule check plus workflow archive must commit atomically; tx is not ACL-wrapped', db, async tx => {
    const workflow = await self.requireOwnedDeskRule(tx, automationId, auth);
    const archived = await tx.workflow.update({
      where: { id: workflow.id },
      data: {
        status: AutomationStatus.ARCHIVED,
        updatedAt: new Date(),
      },
    });
    return workflowToAutomation(archived);
  });
}

export function createRuleTx(self: DeskLabelRulesService, payload: { channelId: string; labelName: string; color?: string | undefined; labelId?: string | undefined; name?: string | undefined; emailFilters?: { fromEmails?: string[] | undefined; fromDomains?: string[] | undefined; toEmails?: string[] | undefined; subjectContains?: string[] | undefined; bodyContains?: string[] | undefined; matchCase?: boolean | undefined; excludedFromEmails?: string[] | undefined; excludedFromDomains?: string[] | undefined; excludedToEmails?: string[] | undefined; excludedSubjectContains?: string[] | undefined; excludedBodyContains?: string[] | undefined; onlyNewThreads?: boolean | undefined; hasAttachments?: boolean | undefined; onlyReplies?: boolean | undefined; } | undefined; keepInInbox?: boolean | undefined; applyToExisting?: boolean | undefined; }, auth: { userId: string; workspaceId: string; }, emailFilters: Record<string, unknown>, filterFingerprint: string, name: string): DeskLabelRulesCreateResult | PromiseLike<DeskLabelRulesCreateResult> {
  return transaction(['Channel', 'ConversationLabel', 'DeskAutoLabelRuleReference', 'Workflow'], 'createRule: label resolve plus workflow and rule-reference inserts must commit atomically; tx is not ACL-wrapped', db, async tx => {
    const label = await resolveOrCreateLabel(tx, payload, auth);
    const config = self.buildValidatedRuleConfig({
      channelId: payload.channelId,
      emailFilters,
      label,
      keepInInbox: payload.keepInInbox,
    });

    const existing = await findOrRestoreExistingDeskWorkflow(self, tx, {
      auth,
      channelId: payload.channelId,
      label,
      filterFingerprint,
      name,
      config,
    });
    if (existing) {
      return workflowToSingleResult(existing, false);
    }

    const id = uuidv4();
    const workflow = await tx.workflow.create({
      data: {
        id,
        workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
        workflowName: name,
        workspaceId: auth.workspaceId,
        status: AutomationStatus.ACTIVE,
        eventType: triggerTypeToEventType(config.trigger.type),
        automationSeriesId: id,
        context: JSON.stringify(config),
        metadata: buildAutomationMetadata({
          description: `Desk auto-label for incoming email -> ${label.name}`,
          createdById: auth.userId,
        }),
      },
    });

    await tx.deskAutoLabelRuleReference.create({
      data: {
        workflowId: workflow.id,
        labelId: label.id,
        workspaceId: auth.workspaceId,
        ownerId: auth.userId,
        channelId: payload.channelId,
        filterFingerprint,
        createdAt: new Date(),
      },
    });

    logger.info(
      `[automations] desk-label-rule created user=${auth.userId} channel=${payload.channelId} label=${label.id}`,
    );
    return workflowToSingleResult(workflow, true);
  });
}

export async function findOrRestoreExistingDeskWorkflow(self: DeskLabelRulesService, tx: Prisma.TransactionClient, params: {
      auth: { userId: string; workspaceId: string };
      channelId: string;
      label: ResolvedConversationLabel;
      filterFingerprint: string;
      name: string;
      config: AutomationConfig;
    }): Promise<Workflow | null> {
    const duplicate = await self.findExistingDeskWorkflow(tx, {
      workspaceId: params.auth.workspaceId,
      ownerId: params.auth.userId,
      channelId: params.channelId,
      labelId: params.label.id,
      filterFingerprint: params.filterFingerprint,
      statuses: [AutomationStatus.ACTIVE, AutomationStatus.DISABLED],
    });
    if (duplicate) {
      return duplicate;
    }

    const archivedDuplicate = await self.findExistingDeskWorkflow(tx, {
      workspaceId: params.auth.workspaceId,
      ownerId: params.auth.userId,
      channelId: params.channelId,
      labelId: params.label.id,
      filterFingerprint: params.filterFingerprint,
      statuses: [AutomationStatus.ARCHIVED],
    });
    if (!archivedDuplicate) {
      return null;
    }

    return restoreArchivedDeskWorkflow(self, tx, archivedDuplicate, params);
  }

export async function resolveOrCreateLabel(tx: Prisma.TransactionClient, payload: DeskLabelRulesPayload, auth: { userId: string; workspaceId: string }): Promise<ResolvedConversationLabel> {
    const labelName = payload.labelName.trim();
    const labelId = payload.labelId?.trim();
    const now = new Date();

    if (labelId) {
      const label = await tx.conversationLabel.findUnique({
        where: { id: labelId },
        select: {
          id: true,
          name: true,
          color: true,
          channelId: true,
          workspaceId: true,
          createdBy: true,
        },
      });
      if (!label || label.workspaceId !== auth.workspaceId || label.channelId !== payload.channelId) {
        throw serviceError('Label not found', 'not-found');
      }
      if (label.createdBy !== auth.userId) {
        throw serviceError('Label does not belong to the current user.', 'forbidden');
      }
      if (label.name !== labelName) {
        throw serviceError('Label id does not match the requested label name.', 'invalid');
      }
      return { id: label.id, name: label.name, color: label.color };
    }

    const channel = await tx.channel.findFirst({
      where: { id: payload.channelId, workspaceId: auth.workspaceId },
      select: { workspaceId: true },
    });
    if (!channel) {
      throw serviceError('Channel not found', 'not-found');
    }

    const label = await tx.conversationLabel.upsert({
      where: {
        channelId_createdBy_name: {
          channelId: payload.channelId,
          createdBy: auth.userId,
          name: labelName,
        },
      },
      create: {
        id: uuidv4(),
        name: labelName,
        ...(payload.color ? { color: payload.color } : {}),
        channelId: payload.channelId,
        // projectId intentionally omitted — conversationLabel.projectId is nullable
        // (channel.projectId is being decoupled); labels are scoped by channel.
        workspaceId: channel.workspaceId,
        createdBy: auth.userId,
        createdAt: now,
        updatedAt: now,
      },
      update: { updatedAt: now },
      select: { id: true, name: true, color: true },
    });

    return label;
  }

export async function restoreArchivedDeskWorkflow(self: DeskLabelRulesService, tx: Prisma.TransactionClient, workflow: Workflow, params: {
      name: string;
      config: AutomationConfig;
      auth: { userId: string; workspaceId: string };
      label: ResolvedConversationLabel;
      channelId: string;
      filterFingerprint: string;
    }): Promise<Workflow> {
    try {
      const restored = await tx.workflow.update({
        where: {
          id: workflow.id,
          status: AutomationStatus.ARCHIVED,
        },
        data: {
          workflowName: params.name,
          status: AutomationStatus.ACTIVE,
          eventType: triggerTypeToEventType(params.config.trigger.type),
          context: JSON.stringify(params.config),
          metadata: buildAutomationMetadata({
            description: `Desk auto-label for incoming email -> ${params.label.name}`,
            createdById: params.auth.userId,
          }),
          updatedAt: new Date(),
        },
      });
      logger.info(
        `[automations] desk-label-rule restored user=${params.auth.userId} channel=${params.channelId} label=${params.label.id}`,
      );
      return restored;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')) {
        throw err;
      }
    }

    const activeDuplicate = await self.findExistingDeskWorkflow(tx, {
      workspaceId: params.auth.workspaceId,
      ownerId: params.auth.userId,
      channelId: params.channelId,
      labelId: params.label.id,
      filterFingerprint: params.filterFingerprint,
      statuses: [AutomationStatus.ACTIVE, AutomationStatus.DISABLED],
    });
    if (!activeDuplicate) {
      throw serviceError('Automation not found', 'not-found');
    }
    return activeDuplicate;
  }
