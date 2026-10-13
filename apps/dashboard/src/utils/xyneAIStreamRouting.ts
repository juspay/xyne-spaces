/**
 * Pure routing helpers for Xyne AI streams. Kept out of the hook/component so
 * the rules that decide "which agent is this run" and "does this stream belong
 * to this thread" can be unit-tested without React.
 */

const DEFAULT_AGENT_SLUG = 'ask-ai';

/**
 * The agent a conversation was last talking to: the newest message that names
 * one. For a chat reloaded mid-run that is the in-flight turn's agent, which
 * is what a live viewer must be attached as — NOT the agent currently picked in
 * the composer (a `setSelectedAgentSlug` has not re-rendered yet, and the user
 * may have picked a different agent elsewhere).
 */
export const lastAgentSlugOf = (
  messages: ReadonlyArray<{ agentSlug?: string | null }>,
): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const slug = messages[i]?.agentSlug;
    if (slug) return slug;
  }
  return undefined;
};

/** Live viewers (reload/reopen mid-run) use stream ids prefixed `live-`. */
export const isLiveViewerStreamId = (streamId: string): boolean => streamId.startsWith('live-');

export interface StreamRoutingInput {
  state: {
    streamId: string;
    agentSlug?: string | null;
    streamSlotKey?: string | null;
    sessionId?: string | null;
  };
  /** Agent the hook is bound to (the selected agent); null/undefined = ask-ai. */
  expectedAgentSlug?: string | null;
  /** Agent of the stream this hook last dispatched (regenerate/edit of another agent's turn). */
  dispatchedAgentSlug?: string | null;
  streamSessionKey?: string | null;
  currentStreamId?: string | null;
  conversationId?: string | null;
}

/**
 * Whether a stream-state notification belongs to the thread a
 * `useXyneAIStream` hook represents.
 *
 * Agent filter: driving streams must match the hook's agent (or the agent it
 * last dispatched). Live viewers are exempt when they match this thread's
 * slot or conversation: they read the conversation-wide `/live` feed
 * (`scope=conversation`), so the run they show belongs to this conversation
 * whichever agent answers it. Filtering them by the selected agent dropped
 * every update — including `done` — when the two disagreed (XYNE-66346).
 */
export const shouldRouteStreamState = ({
  state,
  expectedAgentSlug,
  dispatchedAgentSlug,
  streamSessionKey,
  currentStreamId,
  conversationId,
}: StreamRoutingInput): boolean => {
  const matchesSlot = state.streamSlotKey === streamSessionKey;
  const matchesTrackedStream = !!currentStreamId && state.streamId === currentStreamId;
  // A stream created with a draft slot key gets its server sessionId
  // mid-flight; matching by sessionId still recognises it as this
  // conversation's stream if the slot-key promotion has not landed everywhere.
  const matchesBySessionId =
    !!state.sessionId && !!conversationId && state.sessionId === conversationId;
  if (!matchesSlot && !matchesTrackedStream && !matchesBySessionId) return false;

  const stateAgentSlug = state.agentSlug ?? DEFAULT_AGENT_SLUG;
  const expected = expectedAgentSlug ?? DEFAULT_AGENT_SLUG;
  if (stateAgentSlug === expected || stateAgentSlug === dispatchedAgentSlug) return true;

  return isLiveViewerStreamId(state.streamId) && (matchesSlot || matchesBySessionId);
};
