import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FormFieldType } from '@xyne/shared';

import {
  filterSupportTicketsByDynamicFieldClientFilters,
  parseActualFieldValues,
  toDynamicFieldClientFilters,
  toDynamicFieldQueryFilters,
} from '@/src/features/xyne-desks/tickets/utils/dynamic-field-filters';

describe('toDynamicFieldQueryFilters', () => {
  it('sends chosen values for scalar fields', () => {
    assert.deepEqual(
      toDynamicFieldQueryFilters([
        {
          fieldId: 'bool-1',
          fieldType: FormFieldType.BOOLEAN,
          value: ['true'],
        },
      ]),
      [{ fieldId: 'bool-1', values: ['true', true] }],
    );
  });

  it('omits values for MULTI_SELECT so V4 only checks field presence', () => {
    assert.deepEqual(
      toDynamicFieldQueryFilters([
        {
          fieldId: 'tags',
          fieldType: FormFieldType.MULTI_SELECT,
          value: ['Red', 'Blue'],
        },
      ]),
      [{ fieldId: 'tags' }],
    );
  });
});

describe('toDynamicFieldClientFilters', () => {
  it('keeps MULTI_SELECT values for the client second pass', () => {
    assert.deepEqual(
      toDynamicFieldClientFilters([
        { fieldId: 'tags', fieldType: FormFieldType.MULTI_SELECT, value: ['Red'] },
        { fieldId: 'prio', fieldType: FormFieldType.SINGLE_SELECT, value: ['High'] },
      ]),
      [{ fieldId: 'tags', values: ['Red'] }],
    );
  });
});

describe('parseActualFieldValues', () => {
  it('reads stored arrays and JSON array strings', () => {
    assert.deepEqual(parseActualFieldValues(['Red', 'Blue']), ['Red', 'Blue']);
    assert.deepEqual(parseActualFieldValues('["Red","Blue"]'), ['Red', 'Blue']);
    assert.deepEqual(parseActualFieldValues('"Red"'), ['Red']);
    assert.deepEqual(parseActualFieldValues('Red'), ['Red']);
  });
});

describe('filterSupportTicketsByDynamicFieldClientFilters', () => {
  it('keeps tickets whose multi-select value includes a picked option', () => {
    const rows = [
      {
        id: 'hit',
        formEntityValues: [{ fieldId: 'tags', actualFieldValue: ['Red', 'Green'] }],
      },
      {
        id: 'miss',
        formEntityValues: [{ fieldId: 'tags', actualFieldValue: ['Blue'] }],
      },
      { id: 'empty', formEntityValues: [] },
    ];
    const out = filterSupportTicketsByDynamicFieldClientFilters(rows, [
      { fieldId: 'tags', values: ['Red'] },
    ]);
    assert.deepEqual(
      out.map(row => row.id),
      ['hit'],
    );
  });
});
