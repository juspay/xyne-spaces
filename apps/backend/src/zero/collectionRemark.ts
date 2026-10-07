// Dependency-free on purpose (no @xyne/shared barrel import) so it stays
// cheap to unit-test. Role values mirror the shared CollectionRole enum.
/** Max length of a Knowledge Base collection / folder remark (collections.description). */
export const COLLECTION_REMARK_MAX_LENGTH = 1000;

/**
 * Normalises a user-supplied remark for storage: trims whitespace and maps
 * empty / whitespace-only / null input to `null` (clears the column).
 */
export function normalizeCollectionRemark(remark: string | null | undefined): string | null {
  const trimmed = remark?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Whether a user may set the remark on a collection or any of its
 * sub-folders. Permissions live only on the ROOT collection, so callers must
 * pass the root owner check and the role resolved against the root.
 */
export function canEditCollectionRemark(params: {
  isRootOwner: boolean;
  role: 'OWNER' | 'EDITOR' | 'VIEWER' | string | null | undefined;
}): boolean {
  if (params.isRootOwner) return true;
  return params.role === 'EDITOR' || params.role === 'OWNER';
}
