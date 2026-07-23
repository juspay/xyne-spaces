import { randomUUID } from 'crypto';
import { ActivityType, Prisma } from '@prisma/client';
import { FormFieldType, FormContextType, FormEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';

/**
 * Custom-field plumbing shared by the SEND_CSAT_REQUEST automation step
 * (provisions the fields before sending) and the public CSAT endpoint
 * (writes the customer's response). Writes go through
 * `repositories.forms.upsertTicketFormFields` — the same generic ticket
 * custom-field writer the UPDATE_FORM_FIELDS automation step and the
 * internal ticket-update endpoints already use.
 */

export const CSAT_FIELD_RATING = 'CSAT Rating';
export const CSAT_FIELD_SCORE = 'CSAT Score';
export const CSAT_FIELD_COMMENT = 'CSAT Comment';

export const CSAT_MAX_SCORE = 5;

const CSAT_FIELD_DEFS: Array<{ fieldName: string; fieldType: FormFieldType; fieldEnum?: string[] }> = [
  { fieldName: CSAT_FIELD_RATING, fieldType: FormFieldType.SINGLE_SELECT, fieldEnum: ['GOOD', 'BAD'] },
  { fieldName: CSAT_FIELD_SCORE, fieldType: FormFieldType.NUMBER },
  { fieldName: CSAT_FIELD_COMMENT, fieldType: FormFieldType.STRING },
];

/**
 * Idempotently ensures the 3 CSAT custom fields exist on whichever Form is
 * currently mapped to `boardId`'s ticket form (BOARD/TICKET). Creates a new
 * form+mapping if none exists yet. Never removes existing fields.
 *
 * Called on-demand from both entry points (SEND_CSAT_REQUEST step and the
 * public record endpoint) rather than eagerly for every board — a board
 * that never uses CSAT never gets these fields, and the first ticket that
 * does use CSAT on a given board provisions them for the rest of that board.
 */
export async function ensureCsatFormFields(boardId: string, workspaceId: string, createdBy: string): Promise<void> {
  const mapping = await db.formContextMapping.findFirst({
    where: { contextId: boardId, contextType: 'BOARD', entityType: 'TICKET' },
  });

  const provisionNewForm = async (): Promise<void> => {
    const form = await repositories.forms.createWithFields({
      formName: 'Ticket Details',
      entityType: FormEntityType.TICKET,
      contextType: FormContextType.BOARD,
      workspaceId,
      createdBy,
      fields: CSAT_FIELD_DEFS,
    });
    try {
      await db.formContextMapping.create({
        data: { id: randomUUID(), contextId: boardId, contextType: 'BOARD', entityType: 'TICKET', formId: form.id, workspaceId },
      });
      logger.info(`[csat] provisioned new ticket form with CSAT fields | boardId=${boardId} formId=${form.id}`);
    } catch (err) {
      // Two tickets on the same never-before-CSAT'd board can complete at
      // nearly the same instant, racing to create the first mapping — the
      // `@@unique([contextId, entityType])` constraint rejects the loser.
      // That's fine: the winner's mapping already covers this board, so just
      // fall through as a no-op instead of failing the whole send/record.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        logger.info(`[csat] lost the form-provisioning race, another call already mapped this board | boardId=${boardId}`);
        return;
      }
      throw err;
    }
  };

  if (!mapping) {
    await provisionNewForm();
    return;
  }

  const form = await db.form.findUnique({ where: { id: mapping.formId } });
  if (!form) {
    // Dangling mapping — the mapped Form row is gone. Clean it up and
    // provision a fresh one instead of silently leaving CSAT fields missing
    // (which would otherwise surface downstream as a confusing "ticket not
    // found" error when recording a rating).
    logger.warn(
      `[csat] dangling form mapping, re-provisioning | boardId=${boardId} staleFormId=${mapping.formId}`,
    );
    await db.formContextMapping.delete({ where: { id: mapping.id } });
    await provisionNewForm();
    return;
  }

  const existingFields = await repositories.forms.findFormFields(mapping.formId);
  const existingNames = new Set(existingFields.map(f => f.fieldName));
  const missing = CSAT_FIELD_DEFS.filter(d => !existingNames.has(d.fieldName));
  if (missing.length === 0) return;

  await repositories.forms.updateWithFields(mapping.formId, {
    formName: form.formName,
    formDescription: form.formDescription ?? undefined,
    fields: [
      ...existingFields.map(f => ({
        fieldId: f.id,
        fieldName: f.fieldName,
        fieldType: f.fieldType as unknown as FormFieldType,
        fieldEnum: f.fieldEnum ?? undefined,
        isOptional: f.isOptional,
      })),
      ...missing,
    ],
  });
  logger.info(`[csat] appended missing CSAT fields to existing form | boardId=${boardId} formId=${mapping.formId} missing=${missing.map(m => m.fieldName).join(',')}`);
}

/** Reads the current CSAT Rating custom-field value for a ticket, if any. */
export async function getExistingCsatRating(ticketId: string, boardId: string): Promise<string | null> {
  const data = await repositories.forms.getTicketCustomFormData(ticketId, boardId);
  const field = data?.fields.find(f => f.fieldName === CSAT_FIELD_RATING);
  const value = field?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export interface CsatSubmission {
  ticketId: string;
  rating: 'GOOD' | 'BAD';
  score: number | null;
  comment: string | null;
}

/**
 * Records a customer's rating for a ticket. Public — the caller only needs
 * the ticketId. Idempotent by default — returns `alreadyResponded` if a
 * rating value is already stored, without overwriting it (this is what
 * makes the one-shot email link safe: a link-scanner replay or a second
 * click can't clobber the real submission). Pass `allowOverwrite: true` for
 * callers that legitimately need to update a prior rating (e.g. the
 * external/API-support endpoint, which may re-submit a rating for the same
 * ticket multiple times). `score` is optional, validated 1..CSAT_MAX_SCORE;
 * `comment` is optional free text.
 */
export async function recordCsatRating(
  ticketId: string,
  rating: 'GOOD' | 'BAD',
  comment?: string,
  score?: number,
  allowOverwrite = false,
): Promise<{ success: boolean; alreadyResponded?: boolean; notFound?: boolean; submission?: CsatSubmission }> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { boardId: true, workspaceId: true, createdBy: true, channelId: true },
  });
  if (!ticket) {
    return { success: false, notFound: true };
  }

  const alreadyResponded = await getExistingCsatRating(ticketId, ticket.boardId);
  if (alreadyResponded && !allowOverwrite) {
    return { success: false, alreadyResponded: true };
  }

  const normalizedScore =
    score !== undefined && Number.isFinite(score) && score >= 1 && score <= CSAT_MAX_SCORE
      ? Math.round(score)
      : undefined;
  const normalizedComment =
    comment !== undefined && typeof comment === 'string' && comment.trim().length > 0
      ? comment.trim().slice(0, 2000)
      : undefined;

  // Reuses the same ticket custom-field writer as the internal "update ticket" paths.
  await ensureCsatFormFields(ticket.boardId, ticket.workspaceId, ticket.createdBy);
  const fieldPairs = [
    { fieldName: CSAT_FIELD_RATING, value: rating },
    { fieldName: CSAT_FIELD_SCORE, value: normalizedScore?.toString() },
    { fieldName: CSAT_FIELD_COMMENT, value: normalizedComment },
  ];

  const result = await repositories.forms.upsertTicketFormFields(ticketId, ticket.boardId, fieldPairs);
  if (!result.updatedFields.includes(CSAT_FIELD_RATING)) {
    logger.error(`[csat] recordCsatRating: failed to write CSAT Rating field | ticketId=${ticketId}`);
    return { success: false, notFound: true };
  }

  logger.info(
    `[csat] rating recorded | ticketId=${ticketId} rating=${rating} score=${normalizedScore ?? 'none'}/${CSAT_MAX_SCORE}`,
  );

  // Audit trail + desk metrics. The customer isn't a workspace user, so the
  // activity is attributed to the ticket creator (updatedBy is a required FK).
  // Must never fail the public submission itself.
  try {
    await db.ticketActivity.create({
      data: {
        ticketId,
        updatedBy: ticket.createdBy,
        timestamp: new Date(),
        activityType: ActivityType.CSAT_RECEIVED,
        channelId: ticket.channelId,
        workspaceId: ticket.workspaceId,
        value: {
          field: 'csat',
          rating,
          score: normalizedScore ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.error(`[csat] failed to record CSAT_RECEIVED activity | ticketId=${ticketId} error=${err}`);
  }

  return {
    success: true,
    // Echoed back so a caller (or a downstream automation) can act on exactly
    // what the customer submitted without a second read of the ticket.
    submission: {
      ticketId,
      rating,
      score: normalizedScore ?? null,
      comment: normalizedComment ?? null,
    },
  };
}
