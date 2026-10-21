/** How the transcription / AI agent is labelled everywhere in the call UI. */
export const AI_AGENT_DISPLAY_NAME = 'Xyne Automatic';

/** LiveKit identity of the transcription / AI agent that sits in every call. */
export function isAiAgentIdentity(identity: string | undefined | null): boolean {
  return identity?.startsWith('agent-') ?? false;
}
