import { spacesAppFetch } from "../surfaces/spaces/client.js";
import { postAgentMessage } from "../surfaces/spaces/post-message.js";

// Feature flag: when Spaces has the XYNE-12145 fix deployed
// (POST /api/apps/chat/agentProgress with the authenticateApp middleware), flip
// this to "true" to use the ephemeral <AgentSpinner /> signal path. Default
// false: claw posts a real placeholder message and edits it in-place — works
// on every Spaces version. Once the Spaces fix is live in prod, set
// SPACES_SUPPORTS_AGENT_PROGRESS=true in the deployment env, no code change.
export const USE_EPHEMERAL_PROGRESS = true;

/**
 * Surface a /goal lifecycle phase (Starting…, Turn N/M…) as an EPHEMERAL
 * progress signal instead of a permanent chat message — same surface tool
 * calls use, so the loop's per-turn chatter rides the agent's activity spinner
 * rather than spamming the thread with one message per turn. Terminal outcomes
 * (/goal complete|stopped — reason) deliberately stay real posted messages so
 * the user sees how and why the loop ended.
 *
 * Fire-and-forget; best-effort. When USE_EPHEMERAL_PROGRESS is off (no Spaces
 * agentProgress support), falls back to a normal message so the phase isn't
 * silently lost in that mode.
 */
export async function postGoalPhase(
  fields: { conversationId: string; channelId?: string | undefined; agentSlug?: string | undefined; spacesAppUserId: string; appToken: string },
  label: string,
): Promise<void> {
  try {
    if (USE_EPHEMERAL_PROGRESS) {
      await spacesAppFetch("/chat/agentProgress", {
        conversationId: fields.conversationId,
        ...(fields.channelId ? { channelId: fields.channelId } : {}),
        ...(fields.agentSlug ? { agentSlug: fields.agentSlug } : {}),
        userId: fields.spacesAppUserId,
        toolLabel: label,
        status: "working",
      }, fields.appToken);
    } else if (fields.channelId) {
      await postAgentMessage(
        { spacesAppUserId: fields.spacesAppUserId, appToken: fields.appToken },
        {
          channelId: fields.channelId,
          conversationId: fields.conversationId,
          markdownText: label,
          metadata: { contentFormat: "markdown" },
        }
      );
    } else {
      await spacesAppFetch("/chat/postMessage", {
        conversationId: fields.conversationId,
        markdownText: label,
        userId: fields.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, fields.appToken);
    }
  } catch {
    // Best-effort: a missed progress signal must never break the goal loop.
  }
}
