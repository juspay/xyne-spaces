export function mergeSdlcTicketMetadata(value: unknown, repoId: string): Record<string, unknown> {
  const current =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return { ...current, surface: 'SDLC', repoId };
}
