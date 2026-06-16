import {
  Ticket,
  StageTransition,
  BoardType,
  VisitSlaMode,
  ReenterMode,
  TicketStageRequestStatus,
  ApproverType,
  Prisma,
} from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { FormEntityType } from '@xyne/shared';

const prisma = DatabaseClient.getInstance();

interface TransitionOptions {
  formValues?: Record<string, any>;
  isAutomation?: boolean;
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
      // Check if the requesting user is a listed transition approver (self-approve path)
      const isTransitionApprover = await prisma.stageApprovers.findFirst({
        where: { transitionId: transition.id, userId, approverType: ApproverType.USER },
      });

      if (isTransitionApprover) {
        // User is an approver — record approval and fall through to execute the transition
        await prisma.ticketStageRequest.upsert({
          where: { ticketId_stageId: { ticketId, stageId: targetStage.id } },
          create: {
            ticketId,
            stageId: targetStage.id,
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
    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();

      // 8a. Close current stage ETA (if current stage exists)
      if (currentStage) {
        await tx.ticketStageEta.updateMany({
          where: {
            ticketId,
            stageId: currentStage.id,
            stageLeftAt: null,
          },
          data: {
            stageLeftAt: now,
            updatedAt: now,
            updatedBy: userId,
          },
        });
      }

      // 8b. Determine visit version for target stage
      const maxVisitAgg = await tx.ticketStageEta.aggregate({
        where: { ticketId, stageId: targetStage.id },
        _max: { version: true },
      });

      const maxVisitIndex = maxVisitAgg._max.version ?? 0;
      const hasPriorVisit = maxVisitIndex > 0;

      // Decide re-enter behaviour
      const reenterMode = transition?.onReenter ?? ReenterMode.RESET;
      let newVisitIndex: number;
      let existingEtaToReopen: { id: string; version: number } | null = null;

      if (!hasPriorVisit) {
        newVisitIndex = 1;
      } else if (reenterMode === ReenterMode.CONTINUE) {
        // Re-use the most recent version and reopen that entry
        newVisitIndex = maxVisitIndex;
        const mostRecent = await tx.ticketStageEta.findFirst({
          where: { ticketId, stageId: targetStage.id, version: maxVisitIndex },
          orderBy: { createdAt: 'desc' },
        });
        if (mostRecent) {
          existingEtaToReopen = { id: mostRecent.id, version: mostRecent.version };
        }
      } else {
        // RESET (default) – always increment
        newVisitIndex = maxVisitIndex + 1;
      }

      // 8c. Compute stage ETA
      const stageEta = this.computeStageEta(now, targetStage.eta, transition);

      // 8d. Create or reopen TicketStageEta
      if (existingEtaToReopen) {
        await tx.ticketStageEta.update({
          where: { id: existingEtaToReopen.id },
          data: {
            stageEnteredAt: now,
            stageLeftAt: null,
            stageEta,
            updatedAt: now,
            updatedBy: userId,
          },
        });
      } else {
        await tx.ticketStageEta.create({
          data: {
            ticketId,
            stageId: targetStage.id,
            version: newVisitIndex,
            stageEnteredAt: now,
            stageLeftAt: null,
            stageEta,
            updatedBy: userId,
          },
        });
      }

      // 8e. Update ticket stage
      const updatedTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          stageName: toStageName,
          updatedBy: userId,
          updatedAt: now,
        },
      });

      // 8f. Persist form values (scoped to stage + visitIndex)
      if (formValues && transition?.formId) {
        await this.saveFormValues(
          tx,
          transition.formId,
          ticketId,
          targetStage.id,
          newVisitIndex,
          formValues,
        );
      }

      return { updatedTicket, newVisitIndex };
    });

    // Sync conversation ticket_md outside the transaction
    await syncConversationTicketMdFromPrismaTicket(prisma, result.updatedTicket);

    logger.info(
      `[TicketStageTransitionService] Ticket ${ticketId} moved from "${ticket.stageName}" to "${toStageName}" (visitIndex=${result.newVisitIndex})`,
    );

    return {
      success: true,
      ticket: result.updatedTicket,
      transition: transition || undefined,
      newVisitIndex: result.newVisitIndex,
    };
  }

  /**
   * Compute the stage ETA deadline based on the transition's SLA mode.
   */
  private computeStageEta(
    enteredAt: Date,
    stageEtaHours: number | null,
    transition: StageTransition | null,
  ): Date {
    const slaMode = transition?.visitSlaMode ?? VisitSlaMode.STAGE_DEFAULT;

    switch (slaMode) {
      case VisitSlaMode.FIXED_HOURS:
        if (transition?.fixedEtaHours && transition.fixedEtaHours > 0) {
          return calculateETADeadline(enteredAt, transition.fixedEtaHours);
        }
        // Fall through to stage default if fixed hours not set
        if (stageEtaHours && stageEtaHours > 0) {
          return calculateETADeadline(enteredAt, stageEtaHours);
        }
        return enteredAt;

      case VisitSlaMode.NONE:
        // No SLA tracking; use enteredAt as placeholder (schema requires non-null DateTime)
        return enteredAt;

      case VisitSlaMode.STAGE_DEFAULT:
      default:
        if (stageEtaHours && stageEtaHours > 0) {
          return calculateETADeadline(enteredAt, stageEtaHours);
        }
        return enteredAt;
    }
  }

  /**
   * Persist form entity values scoped to a specific stage visit.
   */
  private async saveFormValues(
    tx: Prisma.TransactionClient,
    formId: string,
    ticketId: string,
    stageId: string,
    version: number,
    formValues: Record<string, any>,
  ): Promise<void> {
    const formFields = await tx.formFields.findMany({
      where: { formId },
    });

    if (formFields.length === 0) {
      logger.warn(
        `[TicketStageTransitionService] No fields found for form ${formId}; skipping form value persistence`,
      );
      return;
    }

    const entries = [];
    for (const [fieldName, value] of Object.entries(formValues)) {
      const field = formFields.find((f) => f.fieldName === fieldName);
      if (!field) continue;

      entries.push({
        formId,
        entityId: ticketId,
        entityType: FormEntityType.TICKET,
        fieldId: field.id,
        contextId: stageId,
        version,
        fieldValue: '',
        actualFieldValue: value as Prisma.InputJsonValue,
      });
    }

    // Upsert each entry so that CONTINUE-mode revisits (same version) overwrite stale values
    // rather than silently skipping via skipDuplicates.
    for (const entry of entries) {
      await tx.formEntityValues.upsert({
        where: {
          entityId_entityType_fieldId_contextId_version: {
            entityId: entry.entityId,
            entityType: entry.entityType,
            fieldId: entry.fieldId,
            contextId: entry.contextId,
            version: entry.version,
          },
        },
        create: entry,
        update: {
          actualFieldValue: entry.actualFieldValue,
          fieldValue: entry.fieldValue,
        },
      });
    }
  }
}

// Singleton export
export const ticketStageTransitionService = new TicketStageTransitionService();
