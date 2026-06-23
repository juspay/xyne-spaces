export function normalizeRfcMessageId(value?: string | null): string | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const withoutAngles = trimmed.replace(/^<|>$/g, '').trim();
  return withoutAngles || undefined;
}

export function normalizeRfcMessageIds(values: string[]): string[] {
  return [...new Set(values.map(normalizeRfcMessageId).filter((id): id is string => !!id))];
}
