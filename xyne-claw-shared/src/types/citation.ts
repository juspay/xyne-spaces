/**
 * Structured citation metadata produced by tools and propagated through
 * subagents to the parent agent. Consumers (claw-auth's appendCitations)
 * use these to render a `### Citations` block without grepping prose for IDs.
 */
export interface Citation {
  /** Optional human-friendly label, e.g., "Spaces thread", "Ticket FOO-123". */
  label?: string;
  /** What kind of resource this citation points to. */
  kind: "thread" | "canvas" | "ticket" | "external";
  /** For kind="thread": channel + conversation IDs. */
  channelId?: string;
  conversationId?: string;
  /** Display name of the channel (e.g. "testing-claw"). Optional but
   *  recommended — citation labels render much better with it. */
  channelName?: string;
  /** Channel scope type: DEFAULT | DM | GROUP_DM | TICKET | DOCUMENT. */
  channelType?: string;
  /** For kind="canvas": shareable view ID. */
  viewAccessId?: string;
  /** For kind="ticket": display ID like "FOO-123". */
  ticketId?: string;
  /** For kind="external": absolute URL. */
  url?: string;
}
