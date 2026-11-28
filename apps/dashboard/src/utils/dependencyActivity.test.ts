import { describe, expect, it } from 'vitest';
import { dependencyActivityDescription } from './dependencyActivity';

describe('dependency activity presentation', () => {
  it.each([
    ['added', 'added a ticket dependency'],
    ['created', 'added a ticket dependency'],
    ['updated', 'updated a ticket dependency'],
    ['removed', 'removed a ticket dependency'],
    ['satisfied', 'satisfied a ticket dependency'],
    ['marked as satisfied', 'satisfied a ticket dependency'],
    ['review', 'marked a ticket dependency as needing review'],
    ['override', 'overrode a ticket dependency gate'],
    ['sub-ticket gating updated', 'updated sub-ticket gating'],
  ])('renders %s without endpoint or private text', (action, expected) => {
    for (const relationType of ['BLOCKS', 'CHILD']) {
      expect(
        dependencyActivityDescription({
          relationType,
          action,
          referenceTicketTitle: 'Private ticket',
          referenceTicketId: 'secret-id',
          overrideReason: 'Private reason',
        }),
      ).toBe(expected);
    }
  });
  it('never echoes unknown dependency actions', () => {
    expect(dependencyActivityDescription({ relationType: 'BLOCKS', action: 'secret-id' })).toBe(
      'updated a ticket dependency',
    );
  });
  it.each(['LINKED', 'DUPLICATE_POSSIBLE', 'DUPLICATE_CONFIRMED', 'MERGED_INTO'])(
    'preserves the legacy %s renderer',
    relationType => {
      expect(dependencyActivityDescription({ relationType, action: 'created' })).toBeNull();
    },
  );
  it.each([null, undefined, '', [], {}])('leaves unrelated values unchanged: %s', value => {
    expect(dependencyActivityDescription(value)).toBeNull();
  });
});
