import { Ticket, StageTransition } from '@prisma/client';
import { ActivitySource } from '@/types/ticket';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import {  BoardType, TicketStageRequestStatus, ApproverType, TicketStatusV2 } from '@xyne/shared';
import { maybeCreateEntryApprovalRequest } from './stageEntryApproval';
import { getTicketBotActorId } from '@/utils/etaNotificationUtils';
import {
  dispatchEtaNotifications,
  etaSignalsFromResult,
} from '@/services/etaManagement';
import { transitionTicketTx } from '@/bypassAcl/transactions/ticketStageTransitionService';

export const prisma = DatabaseClient.getInstance();

interface TransitionOptions {
  formValues?: Record<string, any>;
  isAutomation?: boolean;
  // Provenance tag accepted from callers (e.g. automation steps). The stage move is recorded to
  // the activity timeline / thread by the caller, so this service does not consume it here.
  activitySource?: ActivitySource;
}

interface TransitionResult {
  success: boolean;
  // null only on the failure path (e.g. ticket not found). Callers must check `success` first.
  ticket: Ticket | null;
  transition?: StageTransition;
  requiresApproval?: boolean;
  approvalRequestId?: string;
  newVisitIndex?: number;
  message?: string;
}

export class TicketStageTransitionService {
  /**
   * Validate and execute a stage transition for a ticket.
   *
   * Steps:
   * 1. Resolve ticket + board
   * 2. Resolve target stage by name
   * 3. Look up explicit StageTransition (fromStageId → toStageId)
   * 4. If no transition found:
   *    - DEFAULT board → allow only if target sequenceNumber === current + 1
   *    - NON_LINEAR board → reject
   * 5. If transition.formId exists and no formValues → reject
   * 6. If transition.requiresApproval and not bypassed by automation → create TicketStageRequest
   * 7. Execute transition (close current ETA, create/update target ETA, update ticket.stageName, persist form values)
   */
  async transitionTicket(
    ticketId: string,
    userId: string,
    toStageName: string,
    options: TransitionOptions = {},
  ): Promise<TransitionResult> {
    const { formValues, isAutomation = false } = options;

    // ── 1. Resolve ticket with board ────────────────────────────────────────
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { board: true },
    });

    if (!ticket) {
      return { success: false, ticket: null, message: `Ticket ${ticketId} not found` };
    }

    if (ticket.isArchived) {
      return { success: false, ticket, message: 'Cannot transition an archived ticket' };
    }

    // ── 2. Resolve target stage ─────────────────────────────────────────────
    const targetStage = await prisma.stage.findFirst({
      where: { boardId: ticket.boardId, name: toStageName },
    });

    if (!targetStage) {
      return { success: false, ticket, message: `Stage "${toStageName}" not found in board` };
    }

    // Already in target stage – nothing to do
    if (ticket.stageName === toStageName) {
      return { success: true, ticket, message: 'Ticket is already in the target stage' };
    }

    // ── 3. Resolve current stage ────────────────────────────────────────────
    const currentStage = await prisma.stage.findFirst({
      where: { boardId: ticket.boardId, name: ticket.stageName },
    });

    // ── 4. Look up explicit StageTransition ─────────────────────────────────
    let transition: StageTransition | null = null;

    if (currentStage) {
      transition = await prisma.stageTransition.findUnique({
        where: {
          boardId_fromStageId_toStageId: {
            boardId: ticket.boardId,
            fromStageId: currentStage.id,
            toStageId: targetStage.id,
          },
        },
      });
    }

    // ── 5. If no explicit transition, apply board-type fallback rules ───────
    if (!transition) {
      if (ticket.board.boardType === BoardType.DEFAULT) {
        // Linear board: only allow moving exactly one stage forward
        if (!currentStage) {
          return {
            success: false,
            ticket,
            message: 'Current stage not found; cannot validate linear progression',
          };
        }
        if (targetStage.sequenceNumber !== currentStage.sequenceNumber + 1) {
          return {
            success: false,
            ticket,
            message: `Linear boards only allow sequential forward movement (from ${currentStage.sequenceNumber} to ${currentStage.sequenceNumber + 1})`,
          };
        }
        // Valid linear progression – proceed with default SLA behaviour
      } else if (ticket.board.boardType === BoardType.NON_LINEAR) {
        // Non-linear board: a stage is restricted only when it has outgoing transitions
        // configured. Stages with no outgoing transitions remain unrestricted —
        // configuring one path doesn't lock others.
        const restrictingCount = currentStage
          ? await prisma.stageTransition.count({
              where: {
                boardId: ticket.boardId,
                fromStageId: currentStage.id,
              },
            })
          : 0;
        if (restrictingCount > 0) {
          return {
            success: false,
            ticket,
            message: `No stage transition defined from "${ticket.stageName}" to "${toStageName}"`,
          };
        }
        // No outgoing transitions from current stage → unrestricted
      }
    }

    // ── 6. Form gate ────────────────────────────────────────────────────────
    // formValues === undefined → form was never shown to the user (e.g. direct drag without modal).
    // formValues === {} (empty object) → form was shown but all fields were optional and left blank.
    // Only block on undefined; an empty object is a valid "form acknowledged" signal.
    if (transition?.formId && formValues === undefined) {
      // Only bypass the form gate when there is an active SUBMITTED request — meaning the
      // submitter already filled the form and an approver is completing the transition.
      // APPROVED requests from prior visits must NOT bypass the gate; every fresh
      // transition (including revisits) requires a new form submission.
      const activeRequest = await prisma.ticketStageRequest.findFirst({
        where: {
          ticketId,
          stageId: targetStage.id,
          status: TicketStageRequestStatus.SUBMITTED,
        },
      });

      if (!activeRequest) {
        return {
          success: false,
          ticket,
          transition: transition || undefined,
          message: 'This transition requires a form to be submitted',
        };
      }
    }

    // ── 7. Approval gate ────────────────────────────────────────────────────
    const bypassApproval = isAutomation && (transition?.bypassApprovalForAutomation ?? false);

    if (transition?.requiresApproval && !bypassApproval) {
      // Check if the requesting user is a listed transition approver (self-approve path).
      // A user qualifies if they are listed as a USER approver OR they hold any role listed
      // as a ROLE approver (via user_role_mappings). Legacy rows with NULL approverType are
      // treated as USER.
      const isTransitionApprover = await prisma.stageApprovers.findFirst({
        // userId is populated only for USER-type approvers, so matching transitionId+userId
        // already identifies a USER self-approver — including legacy rows whose approverType
        // is NULL (treated as USER). No approverType filter needed.
        where: {
          transitionId: transition.id,
          userId,
        },
      });

      let isRoleApprover = false;
      if (!isTransitionApprover) {
        const roleApproverRows = await prisma.stageApprovers.findMany({
          where: {
            transitionId: transition.id,
            approverType: ApproverType.ROLE,
            roleId: { not: null },
          },
          select: { roleId: true },
        });
        const roleIds = roleApproverRows
          .map(r => r.roleId)
          .filter((id): id is string => id !== null);
        // Only live roles confer approval rights; a deactivated role must not.
        const activeRoleIds = roleIds.length
          ? (
              await prisma.role.findMany({
                where: { id: { in: roleIds }, isActive: true },
                select: { id: true },
              })
            ).map(r => r.id)
          : [];
        if (activeRoleIds.length > 0) {
          const membership = await prisma.userRoleMapping.findFirst({
            where: { userId, roleId: { in: activeRoleIds } },
          });
          if (!membership) {
            const groupMembership = await prisma.userGroupMapping.findFirst({
              where: { userId, roleId: { in: activeRoleIds } },
            });
            isRoleApprover = !!groupMembership;
          } else {
            isRoleApprover = true;
          }
        }
      }

      if (isTransitionApprover || isRoleApprover) {
        // User is an approver — record approval and fall through to execute the transition
        await prisma.ticketStageRequest.upsert({
          where: { ticketId_stageId: { ticketId, stageId: targetStage.id } },
          create: {
            ticketId,
            stageId: targetStage.id,
            workspaceId: ticket.workspaceId,
            formId: transition.formId ?? null,
            status: TicketStageRequestStatus.APPROVED,
            submittedBy: userId,
            reviewedBy: userId,
            updatedBy: userId,
          },
          update: {
            status: TicketStageRequestStatus.APPROVED,
            reviewedBy: userId,
            updatedBy: userId,
            updatedAt: new Date(),
          },
        });
        // Fall through to execute the transition
      } else {
        const existingRequest = await prisma.ticketStageRequest.findFirst({
          where: {
            ticketId,
            stageId: targetStage.id,
            // Only check SUBMITTED — an APPROVED request from a prior visit must not
            // bypass the approval gate for a new visit (revisit correctness).
            status: TicketStageRequestStatus.SUBMITTED,
          },
        });

        if (existingRequest) {
          return {
            success: false,
            ticket,
            transition: transition || undefined,
            requiresApproval: true,
            approvalRequestId: existingRequest.id,
            message: 'A stage transition request is already pending approval',
          };
        } else {
          const approvalRequest = await prisma.ticketStageRequest.create({
            data: {
              ticketId,
              stageId: targetStage.id,
              workspaceId: ticket.workspaceId,
              formId: transition.formId ?? null,
              status: TicketStageRequestStatus.SUBMITTED,
              submittedBy: userId,
              updatedBy: userId,
            },
          });

          return {
            success: false,
            ticket,
            transition: transition || undefined,
            requiresApproval: true,
            approvalRequestId: approvalRequest.id,
            message: 'Stage transition requires approval',
          };
        }
      }
    }

    // ── 8. Execute transition ───────────────────────────────────────────────
    // Resolved outside the transaction: a stable bot-user lookup, not part of the
    // transactional state, and best kept off the held connection.
    const systemActorId = await getTicketBotActorId(ticket.workspaceId);

    const result = await transitionTicketTx(currentStage, ticketId, userId, targetStage, transition, ticket, formValues, toStageName, systemActorId);

    // Sync conversation ticket_md outside the transaction
    await syncConversationTicketMdFromPrismaTicket(prisma, result.updatedTicket);

    logger.info(
      `[TicketStageTransitionService] Ticket ${ticketId} moved from "${ticket.stageName}" to "${toStageName}" (visitIndex=${result.newVisitIndex})`,
    );

    // Ticket has landed on the target stage — auto-create the approval request for
    // that stage's single outgoing transition if it's configured for on-entry
    // approval. This Prisma write doesn't fire the ticket side effect, so it's an
    // explicit call (the tx.mutate landing paths are covered by TicketsSideEffectHandler).
    // Fire-and-forget: it's best-effort and swallows its own errors, so awaiting
    // would only add latency to the transition response.
    void maybeCreateEntryApprovalRequest(ticketId, userId, toStageName);

    // Post-commit notification dispatch - best-effort, must never affect the already-
    // committed transition response. suppressed while the ticket is paused.
    if (result.updatedTicket.statusV2 !== TicketStatusV2.PAUSED) {
      void dispatchEtaNotifications(etaSignalsFromResult(result.etaResult), {
        ticketId,
        createdBy: ticket.createdBy,
        assignedTo: ticket.assignedTo,
        ticketUserGroupId: ticket.userGroupId,
        boardId: ticket.boardId,
        actorId: userId,
      }).catch(error => {
        logger.error('[TicketStageTransitionService] Failed to dispatch ETA notifications', { ticketId, error });
      });
    }

    return {
      success: true,
      ticket: result.updatedTicket,
      transition: transition || undefined,
      newVisitIndex: result.newVisitIndex,
    };
  }
}

// Singleton export
export const ticketStageTransitionService = new TicketStageTransitionService();

