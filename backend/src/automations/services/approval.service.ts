import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import type { Workflow } from '@/types/database';
import { AccessType } from '@prisma/client';
import { AutomationStatus, isLiveStatus } from '../types/status';
import {
  AUTOMATION_WORKFLOW_TYPE,
  parseAutomationMetadata,
  workflowToAutomation,
  type AutomationView,
} from '../types/workflow-adapter';
import {
  notifyAdminsOfSubmission,
  notifyAuthorOfDecision,
} from './approval-notifications';

const AUTOMATIONS_RESOURCE_NAME = 'AUTOMATIONS';

export class ApprovalError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-found'
      | 'wrong-role'
      | 'wrong-status'
      | 'not-owner'
      | 'not-admin'
      | 'invalid-arg',
  ) {
    super(message);
    this.name = 'ApprovalError';
  }
}

async function assertIsAutomationsAdmin(
  userId: string,
  opts: { isEnvAdmin?: boolean } = {},
): Promise<void> {
  if (opts.isEnvAdmin) return;
  const resource = await repositories.resources.findByName(AUTOMATIONS_RESOURCE_NAME);
  if (!resource) {
    logger.warn(
      `[approval] AUTOMATIONS resource not found in DB. Run scripts/seed-acl.ts.`,
    );
    throw new ApprovalError(
      'AUTOMATIONS resource is not configured on this server.',
      'not-admin',
    );
  }
  const allowed = await repositories.resourceAccess.hasAccess(
    userId,
    resource.id,
    AccessType.ADMIN,
  );
  if (!allowed) {
    throw new ApprovalError(
      'Admin access on the AUTOMATIONS resource is required.',
      'not-admin',
    );
  }
}

function ensureAutomation(workflow: Workflow | null, id: string): Workflow {
  if (!workflow || workflow.workflowType !== AUTOMATION_WORKFLOW_TYPE) {
    throw new ApprovalError(`Automation "${id}" not found.`, 'not-found');
  }
  return workflow;
}

function proposerOf(workflow: Workflow): string {
  return parseAutomationMetadata(workflow.metadata).createdById;
}

class ApprovalService {
  async submitForApproval(proposalId: string, userId: string): Promise<AutomationView> {
    const row = ensureAutomation(await repositories.workflows.findById(proposalId), proposalId);

    if (
      row.status !== AutomationStatus.DRAFT &&
      row.status !== AutomationStatus.PENDING_APPROVAL
    ) {
      throw new ApprovalError(
        `Automation "${proposalId}" is ${row.status}; expected DRAFT or PENDING_APPROVAL.`,
        'wrong-status',
      );
    }
    const author = proposerOf(row);
    if (author && author !== userId) {
      throw new ApprovalError(
        `Only the proposal's author can submit it.`,
        'not-owner',
      );
    }

    const updated =
      row.status === AutomationStatus.PENDING_APPROVAL
        ? row
        : await repositories.workflows.update(proposalId, {
            status: AutomationStatus.PENDING_APPROVAL,
            updatedAt: new Date(),
          });
    logger.info(
      `[approval] submitForApproval OK id=${proposalId} userId=${userId} automationSeriesId=${row.automationSeriesId}`,
    );

    const view = workflowToAutomation(updated);
    void notifyAdminsOfSubmission(view).catch(err =>
      logger.error('[approval] notifyAdminsOfSubmission failed', err),
    );
    return view;
  }

  async revoke(proposalId: string, userId: string): Promise<AutomationView> {
    const row = ensureAutomation(await repositories.workflows.findById(proposalId), proposalId);

    if (
      row.status !== AutomationStatus.PENDING_APPROVAL &&
      row.status !== AutomationStatus.REVOKED
    ) {
      throw new ApprovalError(
        `Proposal "${proposalId}" is ${row.status}; expected PENDING_APPROVAL or REVOKED.`,
        'wrong-status',
      );
    }
    if (proposerOf(row) !== userId) {
      throw new ApprovalError(
        `Only the proposal's author can revoke it.`,
        'not-owner',
      );
    }

    const updated =
      row.status === AutomationStatus.REVOKED
        ? row
        : await repositories.workflows.revokeProposal(proposalId);
    logger.info(`[approval] revoke OK id=${proposalId} userId=${userId}`);
    return workflowToAutomation(updated);
  }

  async approve(
    proposalId: string,
    adminUserId: string,
    note: string | null,
    opts: { isEnvAdmin?: boolean } = {},
  ): Promise<{
    approved: AutomationView;
    autoRevoked: AutomationView[];
  }> {
    await assertIsAutomationsAdmin(adminUserId, opts);
    const row = ensureAutomation(await repositories.workflows.findById(proposalId), proposalId);

    if (
      row.status !== AutomationStatus.PENDING_APPROVAL &&
      row.status !== AutomationStatus.DISABLED
    ) {
      throw new ApprovalError(
        `Proposal "${proposalId}" is ${row.status}; expected PENDING_APPROVAL or DISABLED.`,
        'wrong-status',
      );
    }
    if (proposerOf(row) === adminUserId) {
      throw new ApprovalError(
        `Authors cannot approve their own proposals.`,
        'not-owner',
      );
    }

    const result = await repositories.workflows.approveProposal(proposalId);
    logger.info(
      `[approval] approve OK id=${proposalId} adminUserId=${adminUserId} autoRevokedCount=${result.autoRevoked.length}`,
    );
    const approvedView = workflowToAutomation(result.approved);
    const autoRevokedViews = result.autoRevoked.map(workflowToAutomation);
    void notifyAuthorOfDecision(approvedView, 'approved', note).catch(err =>
      logger.error('[approval] notifyAuthorOfDecision(approved) failed', err),
    );
    for (const view of autoRevokedViews) {
      void notifyAuthorOfDecision(view, 'auto-revoked', null).catch(err =>
        logger.error('[approval] notifyAuthorOfDecision(auto-revoked) failed', err),
      );
    }
    return {
      approved: approvedView,
      autoRevoked: autoRevokedViews,
    };
  }

  async reject(
    proposalId: string,
    adminUserId: string,
    note: string,
    opts: { isEnvAdmin?: boolean } = {},
  ): Promise<AutomationView> {
    if (!note || note.trim().length === 0) {
      throw new ApprovalError(`A reject note is required.`, 'invalid-arg');
    }
    await assertIsAutomationsAdmin(adminUserId, opts);
    const row = ensureAutomation(await repositories.workflows.findById(proposalId), proposalId);

    if (
      row.status !== AutomationStatus.PENDING_APPROVAL &&
      row.status !== AutomationStatus.REJECTED
    ) {
      throw new ApprovalError(
        `Proposal "${proposalId}" is ${row.status}; expected PENDING_APPROVAL or REJECTED.`,
        'wrong-status',
      );
    }
    if (proposerOf(row) === adminUserId) {
      throw new ApprovalError(
        `Authors cannot reject their own proposals.`,
        'not-owner',
      );
    }

    const updated =
      row.status === AutomationStatus.REJECTED
        ? row
        : await repositories.workflows.rejectProposal(proposalId);
    logger.info(
      `[approval] reject OK id=${proposalId} adminUserId=${adminUserId}`,
    );
    const view = workflowToAutomation(updated);
    void notifyAuthorOfDecision(view, 'rejected', note).catch(err =>
      logger.error('[approval] notifyAuthorOfDecision(rejected) failed', err),
    );
    return view;
  }

  async toggleLive(
    liveId: string,
    actorUserId: string,
    nextStatus: AutomationStatus.ACTIVE | AutomationStatus.DISABLED,
    opts: { isEnvAdmin?: boolean } = {},
  ): Promise<AutomationView> {
    if (nextStatus !== AutomationStatus.ACTIVE && nextStatus !== AutomationStatus.DISABLED) {
      throw new ApprovalError(
        `toggleLive only accepts ACTIVE or DISABLED, got "${nextStatus}".`,
        'invalid-arg',
      );
    }
    if (nextStatus === AutomationStatus.DISABLED) {
      await assertIsAutomationsAdmin(actorUserId, opts);
    }
    const row = ensureAutomation(await repositories.workflows.findById(liveId), liveId);

    if (!isLiveStatus(row.status)) {
      throw new ApprovalError(
        `Only LIVE rows can be toggled. "${liveId}" is ${row.status}.`,
        'wrong-role',
      );
    }

    const { automationService } = await import('./automation.service');
    if (nextStatus === AutomationStatus.ACTIVE) {
      const { automation } = await automationService.activate(liveId);
      let archivedCount = 0;
      if (row.automationSeriesId) {
        const archived = await repositories.workflows.archivePriorLiveInLineage(
          row.automationSeriesId,
          liveId,
        );
        archivedCount = archived.length;
      }
      logger.info(
        `[approval] toggleLive ACTIVE id=${liveId} actorUserId=${actorUserId} archivedPrior=${archivedCount}`,
      );
      return automation;
    }
    const automation = await automationService.disable(liveId);
    logger.info(
      `[approval] toggleLive DISABLED id=${liveId} actorUserId=${actorUserId}`,
    );
    return automation;
  }

  async listPendingProposals(): Promise<AutomationView[]> {
    const rows = await repositories.workflows.findPendingProposals();
    return rows.map(workflowToAutomation);
  }

  async listLineageVersions(automationSeriesId: string): Promise<AutomationView[]> {
    const rows = await repositories.workflows.findByautomationSeriesId(automationSeriesId);
    return rows.map(workflowToAutomation);
  }
}

export const approvalService = new ApprovalService();
