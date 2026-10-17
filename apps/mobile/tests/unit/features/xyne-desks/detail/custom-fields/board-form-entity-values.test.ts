import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FormEntityType, FormFieldType } from '@xyne/shared';

import {
  resolveBoardAdditionalFields,
  resolveLeftoverFieldValues,
} from '@/src/features/xyne-desks/detail/custom-fields/board-form-entity-values';
import { resolveDisplayFormFields } from '@/src/features/xyne-desks/detail/custom-fields/resolve-display-form-fields';
import { isFormFieldEmpty } from '@/src/features/xyne-desks/detail/custom-fields/form-field-helpers';

describe('resolveDisplayFormFields', () => {
  it('resolves global and legacy membership rows', () => {
    const fields = resolveDisplayFormFields('form-1', [
      {
        id: 'membership-global',
        globalFieldId: 'gf-1',
        sequenceNumber: 2,
        globalField: {
          fieldName: 'Severity',
          fieldType: FormFieldType.SINGLE_SELECT,
          fieldOptions: [
            { id: 'opt-a', value: 'High' },
            { id: 'opt-b', value: 'Low' },
          ],
        },
      },
      {
        id: 'membership-legacy',
        globalFieldId: null,
        fieldName: 'Notes',
        fieldType: FormFieldType.STRING,
        sequenceNumber: 1,
      },
      {
        id: 'skip-me',
        globalFieldId: null,
      },
    ]);

    assert.equal(fields.length, 2);
    assert.equal(fields[0]?.id, 'membership-legacy');
    assert.equal(fields[1]?.id, 'gf-1');
    assert.equal(fields[1]?.fieldEnum?.[0]?.value, 'High');
  });
});

describe('resolveBoardAdditionalFields', () => {
  it('prefers board context, then prefill, then empty placeholder', () => {
    const mapping = {
      formId: 'form-1',
      formFields: [
        {
          id: 'm1',
          globalFieldId: 'gf-notes',
          globalField: { fieldName: 'Notes', fieldType: FormFieldType.STRING },
          sequenceNumber: 1,
        },
        {
          id: 'm2',
          globalFieldId: 'gf-empty',
          globalField: { fieldName: 'Empty', fieldType: FormFieldType.STRING },
          sequenceNumber: 2,
        },
      ],
    };

    const rows = resolveBoardAdditionalFields({
      formMapping: mapping,
      formEntityValues: [
        {
          id: 'v-board',
          formId: 'form-1',
          fieldId: 'gf-notes',
          contextId: 'board-1',
          fieldValue: '',
          actualFieldValue: 'from-board',
          updatedAt: 2,
        },
        {
          id: 'v-stage',
          formId: 'stage-form',
          fieldId: 'gf-notes',
          contextId: 'stage-1',
          fieldValue: '',
          actualFieldValue: 'from-stage',
          updatedAt: 9,
        },
      ],
      boardId: 'board-1',
      ticketId: 'ticket-1',
      workspaceId: 'ws-1',
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.id, 'v-board');
    assert.equal(rows[0]?.isPlaceholder, false);
    assert.equal(rows[0]?.actualFieldValue, 'from-board');
    assert.equal(rows[1]?.id, 'placeholder-gf-empty');
    assert.equal(rows[1]?.isPlaceholder, true);
    assert.equal(rows[1]?.entityType, FormEntityType.TICKET);
  });

  it('marks entity-wide values as prefill placeholders', () => {
    const mapping = {
      formId: 'form-1',
      formFields: [
        {
          id: 'm1',
          globalFieldId: 'gf-1',
          globalField: { fieldName: 'City', fieldType: FormFieldType.STRING },
        },
      ],
    };

    const rows = resolveBoardAdditionalFields({
      formMapping: mapping,
      formEntityValues: [
        {
          id: 'v-stage',
          formId: 'other-form',
          fieldId: 'gf-1',
          contextId: 'stage-9',
          actualFieldValue: 'Bengaluru',
          updatedAt: 1,
        },
      ],
      boardId: 'board-1',
      ticketId: 'ticket-1',
      workspaceId: 'ws-1',
    });

    assert.equal(rows[0]?.id, 'prefill-gf-1');
    assert.equal(rows[0]?.isPlaceholder, true);
    assert.equal(rows[0]?.contextId, 'board-1');
    assert.equal(rows[0]?.actualFieldValue, 'Bengaluru');
  });
});

describe('resolveLeftoverFieldValues', () => {
  it('returns board values whose field is no longer on the form', () => {
    const leftovers = resolveLeftoverFieldValues({
      formMapping: {
        formId: 'form-1',
        formFields: [
          {
            id: 'm1',
            globalFieldId: 'gf-keep',
            globalField: { fieldName: 'Keep', fieldType: FormFieldType.STRING },
          },
        ],
      },
      formEntityValues: [
        {
          id: 'v-old',
          fieldId: 'gf-gone',
          contextId: 'board-1',
          actualFieldValue: 'retired',
          globalField: { fieldName: 'Retired', fieldType: FormFieldType.STRING },
        },
      ],
      boardId: 'board-1',
    });

    assert.equal(leftovers.length, 1);
    assert.equal(leftovers[0]?.fieldName, 'Retired');
    assert.equal(leftovers[0]?.actualFieldValue, 'retired');
  });
});

describe('isFormFieldEmpty', () => {
  it('treats blank strings and blank arrays as empty', () => {
    assert.equal(isFormFieldEmpty({ fieldValue: '', actualFieldValue: null } as never), true);
    assert.equal(isFormFieldEmpty({ fieldValue: '', actualFieldValue: '  ' } as never), true);
    assert.equal(isFormFieldEmpty({ fieldValue: '', actualFieldValue: ['', ' '] } as never), true);
    assert.equal(isFormFieldEmpty({ fieldValue: '', actualFieldValue: 'ok' } as never), false);
  });
});
