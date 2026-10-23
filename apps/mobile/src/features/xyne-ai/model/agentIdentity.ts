import type { XyneAIAgent } from '../api/xyneAICatalog';
import type { ConversationSummary } from '../api/xyneAIConversations';

/**
 * Who a history row was with, resolved from the agent catalogue.
 *
 * Mirrors the dashboard's `agentIdentity` / `conversationAgents`
 * (`components/Chat/XyneAISidebar/utils/XyneAIUtils.ts`) so a chat reads as the
 * same agent on web and on the phone.
 */

export interface AgentIdentity {
  name: string;
  /** Absent for Ask AI, which follows the user's accent instead. */
  color?: string;
  /** The agent's Spaces bot user, when the server knows it. */
  userId?: string;
}

export type AgentDirectory = ReadonlyMap<string, AgentIdentity>;

const ASK_AI_SLUG = 'ask-ai';

/**
 * Slug → identity. Ask AI is added here rather than in `fetchAgents`, which
 * filters it out on purpose because the agent picker lists it separately.
 */
export function buildAgentDirectory(agents: readonly XyneAIAgent[]): AgentDirectory {
  const directory = new Map<string, AgentIdentity>([[ASK_AI_SLUG, { name: 'Ask AI' }]]);
  for (const agent of agents) {
    directory.set(agent.slug, {
      name: agent.name,
      ...(agent.color ? { color: agent.color } : {}),
      ...(agent.botUserId ? { userId: agent.botUserId } : {}),
    });
  }
  return directory;
}

/** Falls back to the slug for an agent the viewer cannot see any more. */
export const agentIdentity = (directory: AgentDirectory, slug: string): AgentIdentity =>
  directory.get(slug) ?? { name: slug };

/** Every agent a conversation involves; older servers send only `agentSlug`. */
export function conversationAgents(
  conversation: Pick<ConversationSummary, 'agentSlug' | 'agentSlugs'>,
): string[] {
  if (conversation.agentSlugs?.length) return conversation.agentSlugs;
  return conversation.agentSlug ? [conversation.agentSlug] : [];
}

/** The agent shown on a row: the first one the chat was with, as on web. */
export const rowAgentSlug = (
  conversation: Pick<ConversationSummary, 'agentSlug' | 'agentSlugs'>,
): string | undefined => conversationAgents(conversation)[0];

/** First character of the name for the letter tile, `?` when it is blank. */
export const agentInitial = (name: string): string => [...name.trim()][0]?.toUpperCase() ?? '?';
