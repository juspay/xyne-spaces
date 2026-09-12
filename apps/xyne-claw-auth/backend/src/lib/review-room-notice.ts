export const REVIEW_ROOM_MAX_REASON_CHARS = 200;

/**
 * The reason string arrives from claw over S2S and is posted verbatim into a
 * Spaces thread, so it is flattened to a single line of plain text and capped
 * before it can become the body of a message.
 */
export function normalizeReviewRoomReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, REVIEW_ROOM_MAX_REASON_CHARS)
    .replace(/[.\s]+$/, "");
}

export function reviewRoomFailureText(prNumber: string, reason: string): string {
  return `⚠️ Review room${prNumber ? ` for ${prNumber}` : ""} was not generated — ${reason}.`;
}
