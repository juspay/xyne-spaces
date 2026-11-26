import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FormFieldType } from '@xyne/shared';

import { toDynamicFieldQueryFilters } from '@/src/features/xyne-desks/tickets/utils/dynamic-field-filters';

describe('toDynamicFieldQueryFilters', () => {
  it('sends the type and chosen values so the query matches them', () => {
    assert.deepEqual(
      toDynamicFieldQueryFilters([
        { fieldId: 'bool-1', fieldType: FormFieldType.BOOLEAN, value: ['true'] },
        { fieldId: 'tags', fieldType: FormFieldType.MULTI_SELECT, value: ['Red', 'Blue'] },
      ]),
      [
        { fieldId: 'bool-1', fieldType: FormFieldType.BOOLEAN, values: ['true'] },
        { fieldId: 'tags', fieldType: FormFieldType.MULTI_SELECT, values: ['Red', 'Blue'] },
      ],
    );
  });

  it('sends a date range for DATE fields', () => {
    assert.deepEqual(
      toDynamicFieldQueryFilters([
        { fieldId: 'due', fieldType: FormFieldType.DATE, value: { start: 10 } },
      ]),
      [{ fieldId: 'due', fieldType: FormFieldType.DATE, dateRange: { start: 10 } }],
    );
  });

  it('leaves out a field whose type is unknown', () => {
    assert.equal(toDynamicFieldQueryFilters([{ fieldId: 'x', value: ['a'] }]), undefined);
  });
});
