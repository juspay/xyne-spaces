import { Ticket, StageTransition, Prisma } from '@prisma/client';
import { ActivitySource } from '@/types/ticket';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { FormEntityType, BoardType, ReenterMode, TicketStageRequestStatus, ApproverType, TicketStatusV2, parseTicketEtaManagement, mergeTicketEtaManagement } from '@xyne/shared';
import { formService } from '@/services/formService';
import { decideVisitVersion, foldFormRowsToValues } from './visitVersioning';
import { maybeCreateEntryApprovalRequest } from './stageEntryApproval';
import { syncStageOverdueFlag } from '@/services/tickets/syncStageOverdueFlag';
import { getTicketBotActorId } from '@/utils/etaNotificationUtils';
import {
  resolveStepEstimate,
  loadBoardEtaContext,
  evaluateEta,
  buildEtaActivityIntents,
  isTerminalStatus,
  dispatchEtaNotifications,
  etaSignalsFromResult,
  writeEtaActivitiesPrisma,
} from '@/services/etaManagement';

const prisma = DatabaseClient.getInstance();

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
      const reenterMode = transition?.onReenter ?? ReenterMode.RESET;

      let newVisitIndex: number;
      // `existingEtaToReopen` is set only when we are REUSING an existing visit version
      // (form unchanged). `rebaseEta` controls the ETA clock on that reused row.
      let existingEtaToReopen: { id: string } | null = null;
      let rebaseEta = true; // default: (re)start the clock

      if (ticket.board.boardType !== BoardType.NON_LINEAR) {
        // Linear (DEFAULT/RELEASE) boards move strictly forward one stage — there are no
        // revisits, so every transition is visit 1 with a fresh clock. No form comparison
        // is needed (and `formValues` may legitimately be absent for an automation move).
        newVisitIndex = 1;
      } else {
        // NON_LINEAR: data-driven versioning (see visitVersioning.ts). A new version is
        // created ONLY when the submitted form differs from the prior visit's; otherwise
        // the existing version/row is reused. reset/continue governs only the ETA clock.
        let existingEtaIdAtMaxVersion: string | null = null;
        let submittedValues: Record<string, unknown> = {};
        let latestValues: Record<string, unknown> = {};

        if (maxVisitIndex > 0) {
          // The ETA row to reopen when reusing (most recent at maxVisitIndex). NULL version
          // (legacy rows predate the column) is treated as visit 1.
          const mostRecent = await tx.ticketStageEta.findFirst({
            where: { ticketId, stageId: targetStage.id, version: maxVisitIndex },
            orderBy: { createdAt: 'desc' },
          });
          existingEtaIdAtMaxVersion = mostRecent?.id ?? null;

          // Compare submitted form values to the prior visit's stored values, keyed by
          // fieldName. Only run when this edge has a form; an edge with no form has no
          // values to compare (both maps stay empty → equality → reuse path), which is the
          // safe default. submittedValues comes straight from TransitionOptions.formValues
          // (fieldName → value), as the UI/automation sends it.
          if (transition?.formId) {
            const priorRows = await tx.formEntityValues.findMany({
              where: { entityId: ticketId, contextId: targetStage.id },
            });
            const formFieldsForVersioning = await tx.formFields.findMany({
              where: { formId: transition.formId },
              include: { globalField: true },
            });
            const fieldIdToName = new Map(
              formFieldsForVersioning
                .map(f => {
                  const resolvedId = f.globalFieldId ?? f.id;
                  const name = f.globalField?.fieldName ?? f.fieldName;
                  return name ? ([resolvedId, name] as const) : null;
                })
                .filter((entry): entry is readonly [string, string] => entry !== null),
            );
            // latestValues = the prior visit's submission, at version === maxVisitIndex.
            const atMax = priorRows.filter(r => (r.version ?? 1) === maxVisitIndex);
            latestValues = foldFormRowsToValues(atMax, fieldIdToName);
            submittedValues = formValues ?? {};
          }
        }

        const decision = decideVisitVersion({
          maxVersion: maxVisitIndex,
          existingEtaIdAtMaxVersion,
          submittedValues,
          latestValues,
          reenterMode: reenterMode as ReenterMode,
        });
        newVisitIndex = decision.newVersion;
        rebaseEta = decision.rebaseEta;
        existingEtaToReopen = decision.existingEtaId ? { id: decision.existingEtaId } : null;
      }

      // 8c. Compute stage ETA (shared decision table with the ETA domain service, so the
      // live entry path and the forecast path can never drift - see estimateResolution.ts).
      const stepEstimate = resolveStepEstimate(targetStage, transition, {
        requireExplicitTransition: false,
      });
      const stageEta = stepEstimate.hours > 0 ? calculateETADeadline(now, stepEstimate.hours) : now;

      // 8d. Create or reopen TicketStageEta
      if (existingEtaToReopen) {
        // REUSE (form unchanged): rebaseEta (RESET) restarts the clock; CONTINUE keeps it
        // (only clears stageLeftAt — do NOT touch stageEnteredAt/stageEta).
        await tx.ticketStageEta.update({
          where: { id: existingEtaToReopen.id },
          data: rebaseEta
            ? {
                stageEnteredAt: now,
                stageLeftAt: null,
                stageEta,
                updatedAt: now,
                updatedBy: userId,
              }
            : {
                stageLeftAt: null,
                updatedAt: now,
                updatedBy: userId,
              },
        });
      } else {
        // NEW visit version (first visit, or form changed): fresh ETA row at newVisitIndex.
        await tx.ticketStageEta.create({
          data: {
            ticketId,
            stageId: targetStage.id,
            workspaceId: ticket.workspaceId,
            version: newVisitIndex,
            stageEnteredAt: now,
            stageLeftAt: null,
            stageEta,
            updatedBy: userId,
          },
        });
      }

      // 8d-2. ETA domain-service evaluation: forecast (extend-only) + planning-risk state.
      // Re-read the active visit rather than trusting local branch variables above, since a
      // CONTINUE-preserved reopen leaves the row's stageEta untouched (not `stageEta` as
      // just computed) - this is the one authoritative source for "the actual deadline now
      // in effect" regardless of which branch fired.
      const activeVisitRow = await tx.ticketStageEta.findFirst({
        where: { ticketId, stageId: targetStage.id, stageLeftAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const deadlineTracked = activeVisitRow
        ? activeVisitRow.stageEta.getTime() !== activeVisitRow.stageEnteredAt.getTime()
        : false;
      // metadata AND eta were both read before this transaction opened, so a concurrent write
      // (e.g. acknowledgeEtaRisk, or a manual due-date edit) landing before ours would be lost.
      // FOR UPDATE locks the row so that can't happen. Both locked values feed evaluateEta:
      // eta is the extend-only baseline and a fingerprint input, so a stale one could decide
      // against - and then overwrite - a due date someone else just moved.
      const [lockedTicket] = await tx.$queryRaw<{ metadata: unknown; eta: Date | null }[]>`
        SELECT "metadata", "eta"
        FROM "tickets"
        WHERE "id" = ${ticketId}
        FOR UPDATE
      `;
      const lockedEta = lockedTicket?.eta ?? null;
      const boardEtaCtx = await loadBoardEtaContext(tx, ticket.boardId);
      const currentTicketEtaManagement = parseTicketEtaManagement(lockedTicket?.metadata);

      const etaResult = evaluateEta({
        ticketId,
        ticketStatus: ticket.statusV2,
        isTerminal: isTerminalStatus(ticket.statusV2),
        currentTicketEta: lockedEta,
        currentTicketEtaManagement,
        boardType: boardEtaCtx.boardType,
        boardEtaManagement: boardEtaCtx.boardEtaManagement,
        currentStageId: targetStage.id,
        stages: boardEtaCtx.stages,
        transitions: boardEtaCtx.transitions,
        activeVisit: {
          stageVisitId: activeVisitRow?.id ?? null,
          transitionId: transition?.id ?? null,
          deadline: activeVisitRow?.stageEta ?? null,
          deadlineTracked,
          estimateSource: stepEstimate.source,
          estimateHours: stepEstimate.incomplete ? null : stepEstimate.hours,
        },
        trigger: 'STAGE_TRANSITION',
        now,
      });

      // 8e. Update ticket stage (+ ETA/metadata from the domain-service evaluation, in the
      // same write - never a second `ticket.update` call for the same transaction).
      const mergedMetadata = mergeTicketEtaManagement(lockedTicket?.metadata, etaResult.ticketEtaManagementPatch);
      const updatedTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          stageName: toStageName,
          updatedBy: userId,
          updatedAt: now,
          ...(etaResult.etaDecision.changed && etaResult.etaDecision.newEta
            ? { eta: etaResult.etaDecision.newEta }
            : {}),
          metadata: mergedMetadata as Prisma.InputJsonValue,
        },
      });

      await syncStageOverdueFlag(tx, ticketId, now);
      // 8e-2. Audit trail for the ETA evaluation (auto-recompute, risk detected/reopened/
      // resolved, forecast-incomplete) - attributed to the system actor since these are
      // computed by automatic recalculation, not authored by the transitioning user.
      const activityIntents = buildEtaActivityIntents(etaResult, {
        currentStageId: targetStage.id,
        oldEta: lockedEta ? lockedEta.getTime() : null,
        trigger: 'STAGE_TRANSITION',
        systemReason: `Automatic recalculation after moving to stage "${toStageName}"`,
        previousRiskFingerprint: currentTicketEtaManagement.planningRisk.fingerprint,
      });
      await writeEtaActivitiesPrisma(tx, activityIntents, {
        ticketId,
        workspaceId: ticket.workspaceId,
        channelId: ticket.channelId,
        timestamp: now.getTime(),
        systemActorId,
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
          ticket.workspaceId,
        );
      }

      return { updatedTicket, newVisitIndex, etaResult };
    });

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
    workspaceId: string,
  ): Promise<void> {
    const resolvedFields = await formService.resolveFormFieldsForFormId(formId);

    if (resolvedFields.length === 0) {
      logger.warn(
        `[TicketStageTransitionService] No fields found for form ${formId}; skipping form value persistence`,
      );
      return;
    }

    const entries = [];
    for (const [fieldName, value] of Object.entries(formValues)) {
      const field = resolvedFields.find(f => f.fieldName === fieldName);
      if (!field) continue;

      entries.push({
        formId,
        entityId: ticketId,
        entityType: FormEntityType.TICKET,
        fieldId: field.id,
        contextId: stageId,
        workspaceId,
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
