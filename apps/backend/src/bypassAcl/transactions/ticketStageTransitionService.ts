import { transaction } from '../base';
import { resolveStepEstimate, evaluateEta, isTerminalStatus, buildEtaActivityIntents, writeEtaActivitiesPrisma } from '@/services/etaManagement';
import { loadBoardEtaContext } from '@/bypassAcl/transactions/prismaContext';
import { prisma } from '@/services/stageTransition/ticketStageTransitionService';
import { foldFormRowsToValues, decideVisitVersion } from '@/services/stageTransition/visitVersioning';
import { syncStageOverdueFlag } from '@/services/tickets/syncStageOverdueFlag';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { Prisma } from '@prisma/client';
import { ReenterMode, BoardType, parseTicketEtaManagement, mergeTicketEtaManagement, FormEntityType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { formService } from '@/services/formService';
import { lockTicketMetadataAndEta } from '@/bypassAcl/rowLockServices';


export function transitionTicketTx(currentStage: any, ticketId: string, userId: string, targetStage: any, transition: any, ticket: any, formValues: Record<string, any> | undefined, toStageName: string, systemActorId: string) {
  return transaction(['Board', 'FormEntityValues', 'FormFields', 'Stage', 'StageTransition', 'Ticket', 'TicketActivity', 'TicketStageEta'], 'transitionTicket: stage-visit versioning with ETA evaluation, ticket update, and form persistence must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
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
    const lockedTicket = await lockTicketMetadataAndEta(tx, ticketId);
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
      await saveFormValues(tx, transition.formId, ticketId, targetStage.id, newVisitIndex, formValues, ticket.workspaceId);
    }

    return { updatedTicket, newVisitIndex, etaResult };
  });
}

  /**
   * Persist form entity values scoped to a specific stage visit.
   */
export async function saveFormValues(tx: Prisma.TransactionClient, formId: string, ticketId: string, stageId: string, version: number, formValues: Record<string, any>, workspaceId: string): Promise<void> {
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
