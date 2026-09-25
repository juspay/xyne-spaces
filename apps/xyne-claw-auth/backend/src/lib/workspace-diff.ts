export const WORKSPACE_DIFF_FILENAME = "changes.patch";
export const WORKSPACE_DIFF_MIME = "text/x-patch";

export function workspaceDiffRefId(conversationId: string): string {
  return `local:${conversationId}`;
}

export function isWorkspaceDiffMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.trim().toLowerCase() === WORKSPACE_DIFF_MIME;
}
