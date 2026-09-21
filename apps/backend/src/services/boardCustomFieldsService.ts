import { FormContextType, FormEntityType, parseFieldOptions } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';

const TAG = '[BoardCustomFields]';

// Repoint existing ticket values in batches so a board with a long release history
// doesn't build one enormous IN (...) clause.
const TICKET_ID_CHUNK_SIZE = 500;

export interface DetachedFormField {
  fieldName: string;
  fieldType: string;
  /** Resolved field id on the forked form (global-field id, or membership id for legacy). */
  fieldId: string;
  /** form_fields row id on the forked form. */
  membershipId: string | null;
}

export interface DetachSharedBoardFormResult {
  /** The form this board's ticket custom fields should now be edited through. */
  formId: string;
  /** True when this call actually forked a shared form into a board-owned one. */
  detached: boolean;
  /** Number of existing ticket custom-field values repointed onto the forked form. */
  repointedValues: number;
  /**
   * The forked form's fields. The caller must re-key its edited field list onto these ids
   * before updating the form — the ids it was holding belong to the shared form.
   */
  fields: DetachedFormField[];
}

/**
 * Release boards are all bound to ONE seeded, workspace-wide form
 * (`xyne_release_specs_form` / `xyne_release_version_specs_form`, see
 * `saveReleaseBoardConfig` in zero/mutators.ts). Editing custom fields from any one
 * board therefore edits the fields of EVERY board bound to that form — a field added
 * on one release board becomes visible, and mandatory, on all of them.
 *
 * This service forks that shared form the first time a board edits its custom fields:
 * the board gets its own copy of the exact same fields, its mapping is repointed at the
 * copy, and the board's existing ticket values are moved onto the copy's field ids so
 * nothing already captured is lost. Boards still bound to the shared form are untouched.
 *
 * A board whose form is already private (only one context mapping) is left exactly as
 * it is — this is a no-op for every non-release board.
 */
export class BoardCustomFieldsService {
  async detachSharedBoardTicketForm(
    boardId: string,
    actorUserId: string,
  ): Promise<DetachSharedBoardFormResult | null> {
    const board = await db.board.findUnique({
      where: { id: boardId },
      select: { id: true, name: true, projectId: true, workspaceId: true },
    });
    if (!board) return null;

    const mapping = await db.formContextMapping.findFirst({
      where: {
        contextId: boardId,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
    });
    // No form bound yet — the caller's normal "create a new form" path already produces
    // a board-owned form, so there is nothing to fork.
    if (!mapping) return null;

    const sharedWith = await db.formContextMapping.count({
      where: { formId: mapping.formId, NOT: { contextId: boardId } },
    });
    if (sharedWith === 0) {
      return { formId: mapping.formId, detached: false, repointedValues: 0, fields: [] };
    }

    const sourceForm = await repositories.forms.findFormWithFields(mapping.formId);
    if (!sourceForm) {
      return { formId: mapping.formId, detached: false, repointedValues: 0, fields: [] };
    }

    const newForm = await repositories.forms.createWithFields({
      formName: `${board.name} Custom Fields`,
      formDescription: `Custom fields for ${board.name}`,
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
      workspaceId: board.workspaceId,
      createdBy: actorUserId,
      projectId: board.projectId,
      fields: sourceForm.fields.map(field => {
        const options = parseFieldOptions(field.fieldOptions);
        return {
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          ...(options.length > 0 ? { fieldOptions: options } : {}),
          isOptional: field.isOptional,
          ...(field.parentOptionId !== undefined
            ? { parentOptionId: field.parentOptionId }
            : {}),
        };
      }),
    });

    // `createWithFields` resolves each field onto a project-scoped global definition, so a
    // field that already had one keeps its id (nothing to repoint) while a legacy field —
    // which the seeded release forms use — lands on a brand-new id. Read back what was
    // actually created rather than assuming ids survived.
    const clonedForm = await repositories.forms.findFormWithFields(newForm.id);
    const fieldRepoints: Array<{ oldFieldId: string; newFieldId: string }> = [];
    if (clonedForm) {
      for (const oldField of sourceForm.fields) {
        const match = clonedForm.fields.find(
          f => f.fieldName === oldField.fieldName && f.fieldType === oldField.fieldType,
        );
        if (match && match.id !== oldField.id) {
          fieldRepoints.push({ oldFieldId: oldField.id, newFieldId: match.id });
        }
      }
    }

    const repointedValues = await this.repointBoardTicketValues(
      boardId,
      mapping.formId,
      newForm.id,
      fieldRepoints,
    );

    await db.formContextMapping.update({
      where: { id: mapping.id },
      data: { formId: newForm.id },
    });

    logger.info(
      `${TAG} Board ${boardId} forked shared form ${mapping.formId} -> ${newForm.id} `
        + `(${repointedValues} value(s) repointed) for ${actorUserId}`,
    );

    return {
      formId: newForm.id,
      detached: true,
      repointedValues,
      fields: (clonedForm?.fields ?? []).map(field => ({
        fieldName: field.fieldName,
        fieldType: field.fieldType,
        fieldId: field.id,
        membershipId: field.membershipId ?? null,
      })),
    };
  }

  /**
   * Moves this board's existing ticket custom-field values from the shared form onto the
   * forked one. Scoped by the board's own tickets — values belonging to other boards bound
   * to the same shared form must stay exactly where they are.
   */
  private async repointBoardTicketValues(
    boardId: string,
    oldFormId: string,
    newFormId: string,
    fieldRepoints: Array<{ oldFieldId: string; newFieldId: string }>,
  ): Promise<number> {
    const tickets = await db.ticket.findMany({ where: { boardId }, select: { id: true } });
    if (tickets.length === 0) return 0;
    const ticketIds = tickets.map(t => t.id);

    let repointed = 0;
    for (let i = 0; i < ticketIds.length; i += TICKET_ID_CHUNK_SIZE) {
      const chunk = ticketIds.slice(i, i + TICKET_ID_CHUNK_SIZE);

      // Fields whose id changed: move both the id and the form reference.
      for (const { oldFieldId, newFieldId } of fieldRepoints) {
        const { count } = await db.formEntityValues.updateMany({
          where: {
            formId: oldFormId,
            fieldId: oldFieldId,
            entityType: FormEntityType.TICKET,
            entityId: { in: chunk },
          },
          data: { fieldId: newFieldId, formId: newFormId, updatedAt: new Date() },
        });
        repointed += count;
      }

      // Fields that kept their id (already global-backed) only need the form reference.
      const { count } = await db.formEntityValues.updateMany({
        where: {
          formId: oldFormId,
          entityType: FormEntityType.TICKET,
          entityId: { in: chunk },
        },
        data: { formId: newFormId, updatedAt: new Date() },
      });
      repointed += count;
    }

    return repointed;
  }
}

export const boardCustomFieldsService = new BoardCustomFieldsService();
