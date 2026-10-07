import {
  COLLECTION_REMARK_MAX_LENGTH,
  canEditCollectionRemark,
  normalizeCollectionRemark,
} from './collectionRemark';

describe('normalizeCollectionRemark', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeCollectionRemark('  Q3 onboarding docs \n')).toBe('Q3 onboarding docs');
  });

  it('keeps inner newlines', () => {
    expect(normalizeCollectionRemark('line 1\nline 2')).toBe('line 1\nline 2');
  });

  it.each([null, undefined, '', '   ', '\n\t'])('clears %p to null', input => {
    expect(normalizeCollectionRemark(input)).toBeNull();
  });
});

describe('canEditCollectionRemark', () => {
  it('allows the root collection owner regardless of permission rows', () => {
    expect(canEditCollectionRemark({ isRootOwner: true, role: null })).toBe(true);
  });

  it.each(['OWNER', 'EDITOR'])('allows %s on the root', role => {
    expect(canEditCollectionRemark({ isRootOwner: false, role })).toBe(true);
  });

  it.each(['VIEWER', null, undefined])('rejects %p', role => {
    expect(canEditCollectionRemark({ isRootOwner: false, role })).toBe(false);
  });
});

describe('COLLECTION_REMARK_MAX_LENGTH', () => {
  it('is 1000 characters (kept in sync with the dashboard REMARK_MAX_LENGTH)', () => {
    expect(COLLECTION_REMARK_MAX_LENGTH).toBe(1000);
  });
});
