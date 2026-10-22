import { describe, expect, it, vi } from 'vitest';

vi.mock('../SchemaForm/SchemaForm', () => ({ SchemaForm: () => null }));
vi.mock('../SchemaForm/SchemaForm.utils', () => ({ resolveSchema: (s: unknown) => s }));
vi.mock('../SchemaForm/VariableAwareInput', () => ({ VariableAwareInput: () => null }));
vi.mock('../../../../hooks/useCachedQuery', () => ({ useCachedQuery: () => [undefined] }));
vi.mock('../../../../zero/queries', () => ({ queries: {} }));
vi.mock('../../../../utils/board/resolveDisplayFormFields', () => ({
  resolveDisplayFormFields: () => [],
}));

import { literalBoardId, upsertFormFieldRow } from './CreateTicketStepForm';

describe('literalBoardId', () => {
  it('returns a typed board id', () => {
    expect(literalBoardId(' board-1 ')).toBe('board-1');
  });
  it('ignores variables, blanks and non-strings', () => {
    expect(literalBoardId('{{trigger.boardId}}')).toBeNull();
    expect(literalBoardId('')).toBeNull();
    expect(literalBoardId(undefined)).toBeNull();
  });
});

describe('upsertFormFieldRow', () => {
  const rows = [{ fieldName: 'branch', value: 'main' }];
  it('adds a new field', () => {
    expect(upsertFormFieldRow(rows, 'newCommitId', 'abc')).toEqual([
      { fieldName: 'branch', value: 'main' },
      { fieldName: 'newCommitId', value: 'abc' },
    ]);
  });
  it('updates an existing field in place', () => {
    expect(upsertFormFieldRow(rows, 'branch', 'release-sandbox')).toEqual([
      { fieldName: 'branch', value: 'release-sandbox' },
    ]);
  });
  it('removes a field when the value is cleared', () => {
    expect(upsertFormFieldRow(rows, 'branch', '')).toEqual([]);
  });
});
