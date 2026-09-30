export const normalizePollChoice = (text: string): string =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

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
