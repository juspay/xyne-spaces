import assert from 'node:assert/strict';
import { it } from 'node:test';
import { FormFieldType } from '@xyne/shared';
import {
  activeTicketFields,
  ticketDynamicFieldErrors,
} from '@/src/features/chat/thread-header/thread-ticket-form';
import type { ResolvedDisplayFormField } from '@/src/features/chat/thread-header/resolve-ticket-form-fields';
const fields: ResolvedDisplayFormField[] = [
  {
    id: 'kind',
    formId: 'form',
    fieldName: 'Kind',
    fieldType: FormFieldType.SINGLE_SELECT,
    fieldEnum: [
      { id: 'opt', value: 'Incident' },
      { id: 'other', value: 'Other' },
    ],
    isOptional: false,
    sequenceNumber: 0,
  },
  {
    id: 'impact',
    formId: 'form',
    fieldName: 'Impact',
    fieldType: FormFieldType.NUMBER,
    parentOptionId: 'opt',
    isOptional: false,
    sequenceNumber: 1,
  },
];
it('only validates fields in the selected branch and prunes hidden values', () => {
  assert.deepEqual(
    activeTicketFields(fields, { Kind: 'Other', Impact: 'old' }).map(field => field.fieldName),
    ['Kind'],
  );
  assert.deepEqual(ticketDynamicFieldErrors(fields, { Kind: 'Other' }), []);
  assert.deepEqual(ticketDynamicFieldErrors(fields, { Kind: 'Incident' }), ['Impact is required']);
});
it('accepts zero but rejects non-numeric values in numeric fields', () => {
  assert.deepEqual(ticketDynamicFieldErrors(fields, { Kind: 'Incident', Impact: '0' }), []);
  assert.deepEqual(ticketDynamicFieldErrors(fields, { Kind: 'Incident', Impact: 'NaN' }), [
    'Impact must be a number',
  ]);
});

it('recognizes both current ticket relations and legacy source-message ticket markers', async () => {
  const { threadHasTicket } = await import('@/src/features/chat/thread-header/thread-ticket-form');
  assert.equal(threadHasTicket({ ticketId: 'ticket' }), true);
  assert.equal(threadHasTicket({ initialMessage: { metadata: { ticketId: 'ticket' } } }), true);
  assert.equal(threadHasTicket({ metadata: { ticketId: 'ticket' } }), true);
  assert.equal(threadHasTicket({ metadata: {} }), false);
});
