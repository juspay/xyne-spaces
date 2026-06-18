export function mergeCollectionItemMetadata(
  existingMetadata: unknown,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const baseMetadata =
    typeof existingMetadata === 'object' && existingMetadata !== null
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {}
  return { ...baseMetadata, ...updates }
}
