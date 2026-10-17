/**
 * Gmail-style multi-value filter chip label:
 * - none → emptyLabel (e.g. "Stages")
 * - one  → that value
 * - many → "First + N more"
 */
export function formatMultiSelectFilterLabel(
  values: readonly string[],
  emptyLabel: string,
): string {
  if (values.length === 0) return emptyLabel;

  const first = values[0]?.trim() || emptyLabel;
  if (values.length === 1) return first;

  const more = values.length - 1;
  return `${first} + ${more} more`;
}
