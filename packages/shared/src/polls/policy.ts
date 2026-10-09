export const normalizePollChoice = (text: string): string =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export const isPollClosedAt = (
  poll: { closedAt?: number | null },
  _timestamp: number,
): boolean => poll.closedAt != null;

export function canViewPollResults(context: PollResultAccessContext): boolean {
  if (context.isPollCreator) return true;

  switch (context.visibility) {
    case "EVERYONE":
      return true;
    case "CREATOR_ONLY":
      return false;
    case "AFTER_CLOSE":
      return context.isClosed;
    case "ADMIN_ONLY":
      return context.isChannelCreator || context.isChannelAdmin;
  }
}

export function canViewPollVoterIdentities(context: {
  isAnonymous: boolean;
  isPollCreator: boolean;
}): boolean {
  return !context.isAnonymous && context.isPollCreator;
}

export function assertPollPlacement(
  poll: unknown,
  placement: "channel" | "thread",
): void {
  if (poll && placement === "thread") {
    throw new Error("Polls can only be posted as top-level channel messages");
  }
}

export function assertPollMessageActive(
  message: { isDeleted: boolean } | null | undefined,
): void {
  if (!message) {
    throw new Error("Poll message is not available");
  }
  if (message.isDeleted) {
    throw new Error("This poll message was deleted");
  }
}

export function isPollMessageMetadata(metadata: unknown): boolean {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).messageSubtype === "poll"
  );
}
import type { PollResultAccessContext } from "./types.js";
