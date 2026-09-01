/**
 * Ephemeral flow messages are broadcast over Redis pub/sub and never written to
 * the messages table, but FlowController.executeAction resolves the owning appId
 * by reading the stored message content. This holds just enough to authorize an
 * action — the rendered content and the one user it was delivered to.
 */
import { redisService } from '@/services/redisService';

/** Matches Slack's response_url window for interactive ephemerals. */
const TTL_SECONDS = 30 * 60;

export interface EphemeralFlow {
  /** Rendered content, carrying the data-flow-appid that identifies the app. */
  content: string;
  /** The only user permitted to dispatch actions for this message. */
  visibleTo: string;
}

const key = (messageId: string): string => `ephemeral:flow:${messageId}`;

export async function storeEphemeralFlow(messageId: string, entry: EphemeralFlow): Promise<void> {
  await redisService.set(key(messageId), JSON.stringify(entry), TTL_SECONDS);
}

export async function getEphemeralFlow(messageId: string): Promise<EphemeralFlow | null> {
  const raw = await redisService.get(key(messageId));
  return raw ? (JSON.parse(raw) as EphemeralFlow) : null;
}

/**
 * Drop the authorization record once the interaction is over, so the Submit button
 * cannot be pressed a second time inside the TTL window.
 */
export async function deleteEphemeralFlow(messageId: string): Promise<void> {
  await redisService.del(key(messageId));
}
