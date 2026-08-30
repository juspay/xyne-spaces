/** Shared MIME and extension matching for inbound attachments. */
export function matchesAttachmentType(
  fileName: string,
  mimeType: string | null | undefined,
  mimeTypes: ReadonlySet<string>,
  extensions: ReadonlySet<string>,
): boolean {
  const normalizedMimeType = (mimeType ?? "").toLowerCase();
  for (const candidate of mimeTypes) {
    const matchesMimeType = candidate.endsWith("/")
      ? normalizedMimeType.startsWith(candidate)
      : normalizedMimeType === candidate;
    if (matchesMimeType) {
      return true;
    }
  }

  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return extensions.has(fileName.slice(dot).toLowerCase());
}
