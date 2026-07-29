/**
 * Redis-backed OAuth state: the memory between "we sent an admin to Slack's
 * consent screen" and "their browser came back to /oauth/callback". Each
 * pending install is one key carrying its context (org, user, registration);
 * entries are single-use (atomic read+delete) and expire after 10 minutes,
 * so install URLs are always minted fresh per click. Redis (not process
 * memory) because the callback may land on a different replica than the one
 * that minted the state.
 */
import { randomBytes } from "node:crypto";
import { redisService } from "../../redis.js";
import { SLACK_SCOPES, slackCallbackUri } from "./manifest.js";
import { OAUTH_STATE_PREFIX, OAUTH_STATE_TTL_SECONDS } from "./const.js";


export interface SlackOAuthState {
  orgId: string;
  userId: string;
  /** The app registration being installed — every install is per-agent. */
  surfaceAgentId: string;
}

export async function createOAuthState(input: SlackOAuthState): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const redis = redisService.getConnection();
  await redis.set(`${OAUTH_STATE_PREFIX}${state}`, JSON.stringify(input), "EX", OAUTH_STATE_TTL_SECONDS);
  return state;
}

/** Single-use consume: returns the pending context and deletes it atomically. */
export async function takeOAuthState(value: unknown): Promise<SlackOAuthState | null> {
  if (typeof value !== "string" || !value) return null;
  const redis = redisService.getConnection();
  const key = `${OAUTH_STATE_PREFIX}${value}`;
  const transaction = await redis.multi().get(key).del(key).exec();
  const [getReply] = transaction ?? [];
  const [getError, storedJson] = getReply ?? [null, null];
  if (getError || typeof storedJson !== "string") return null;
  try {
    return JSON.parse(storedJson) as SlackOAuthState;
  } catch {
    return null;
  }
}

/** A fresh single-use install URL for a per-agent app registration. */
export async function createAgentInstallUrl(input: {
  orgId: string;
  userId: string;
  surfaceAgentId: string;
  clientId: string;
}): Promise<string> {
  const state = await createOAuthState({
    orgId: input.orgId,
    userId: input.userId,
    surfaceAgentId: input.surfaceAgentId,
  });
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", SLACK_SCOPES.join(","));
  url.searchParams.set("redirect_uri", slackCallbackUri());
  url.searchParams.set("state", state);
  return url.toString();
}
