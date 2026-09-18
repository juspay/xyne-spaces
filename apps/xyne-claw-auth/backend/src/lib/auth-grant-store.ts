/**
 * Pending auth grants — "this run stopped because it needs a credential the
 * user can supply; resume it the moment they do."
 *
 * Redis with a 24h TTL and an atomic `getdel` on consumption, so a double-fired
 * connect (an OAuth callback racing a manual save) cannot dispatch the same run
 * twice. No credential is stored here, only a pointer to the connector and the
 * task to replay.
 */

import crypto from "node:crypto";
import { redisService } from "../redis.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("auth-grant");

const GRANT_PREFIX = "auth-grant:";
const INDEX_PREFIX = "auth-grant-index:";
/** Matches pending-questions.ts — an OAuth round trip can take a while. */
const TTL_SECONDS = 24 * 60 * 60;
/** One user connecting one provider should not fan out into a run storm. */
const MAX_RESUMES_PER_CONNECT = 5;

export interface AuthGrantRedispatch {
  userId: string;
  task: string;
  agentSlug: string;
  orgId: string;
  conversationId: string;
  channelId: string;
  eventType?: string;
  resultForwardUrl?: string;
  /**
   * Which surface parked the run, and therefore which door the resume comes
   * back through. A chat run finalises a pre-created assistant message; a
   * Spaces run delivers to `/webhook/result`. Resuming everything through the
   * Spaces callback left chat-started runs with no visible reply at all.
   */
  surface?: "chat" | "spaces";
}

export interface PendingAuthGrant {
  grantId: string;
  userId: string;
  serverType: string;
  providerLabel: string;
  host: string;
  /** The URL the run was blocked on — replayed into the continuation prompt. */
  url: string;
  /**
   * What the agent said it was doing when it got blocked. More reliable than
   * the run's `task`, which is whatever the user typed on the turn that
   * happened to trigger the block rather than the goal.
   */
  reasonText?: string;
  redispatch: AuthGrantRedispatch;
  createdAt: number;
}

const grantKey = (grantId: string): string => `${GRANT_PREFIX}${grantId}`;

/** A grant is addressed by (user, connector, conversation). */
function grantIdFor(userId: string, serverType: string, conversationId: string): string {
  return crypto
    .createHash("sha256")
    .update(`${userId}|${serverType}|${conversationId}`)
    .digest("hex")
    .slice(0, 32);
}
/** Index is per (user, connector): connecting once must unblock every run waiting on it. */
const indexKey = (userId: string, serverType: string): string =>
  `${INDEX_PREFIX}${userId}:${serverType}`;

/**
 * Record a blocked run. Idempotent per (user, connector, conversation): a run
 * that hits the same wall on three URLs produces one card and one resume.
 */
export async function registerAuthGrant(
  grant: Omit<PendingAuthGrant, "grantId" | "createdAt">,
): Promise<string | null> {
  try {
    const redis = redisService.getConnection();
    const dedupeId = grantIdFor(grant.userId, grant.serverType, grant.redispatch.conversationId);
    const record: PendingAuthGrant = { ...grant, grantId: dedupeId, createdAt: Date.now() };

    await redis.set(grantKey(dedupeId), JSON.stringify(record), "EX", TTL_SECONDS);
    await redis.sadd(indexKey(grant.userId, grant.serverType), dedupeId);
    await redis.expire(indexKey(grant.userId, grant.serverType), TTL_SECONDS);
    log.info(
      `[auth-grant] registered grant=${dedupeId} user=${grant.userId} type=${grant.serverType} host=${grant.host}`,
    );
    return dedupeId;
  } catch (err) {
    // Never fail the run's callback over this; the user can always re-ask.
    log.error(`[auth-grant] register failed for ${grant.serverType}:`, err);
    return null;
  }
}

/** Atomically take a grant so two concurrent connect events cannot both replay it. */
async function consumeGrant(grantId: string): Promise<PendingAuthGrant | null> {
  const redis = redisService.getConnection();
  const raw = await redis.getdel(grantKey(grantId));
  return raw ? (JSON.parse(raw) as PendingAuthGrant) : null;
}

const s2sHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
});

/** What the agent is told to do next, kept out of the visible message. */
function resumeInstructions(grant: PendingAuthGrant): string {
  // Prefer the agent's own account of what it was doing; fall back to the run
  // task only when there is none (a server-detected 401 carries no narrative).
  const goal = grant.reasonText?.trim()
    ? `What you were doing when you stopped: ${grant.reasonText.trim()}`
    : `The request that was in flight came from this task:\n${grant.redispatch.task}`;
  return (
    `The user just granted access to ${grant.providerLabel}, so ${grant.host} is now reachable. ` +
    `Retry ${grant.url} and finish what you were doing.\n\n${goal}`
  );
}

/**
 * Resume a chat-started run through `POST /agent-chat/:slug/chat`, the same
 * endpoint a typed message uses: it creates the assistant placeholder row and
 * wires the progress stream, which calling `/internal/run` directly skipped.
 * The retry instructions ride in `additionalInstructions` so they are not
 * rendered as a chat bubble.
 */
async function dispatchChatResume(grant: PendingAuthGrant): Promise<boolean> {
  const res = await fetch(
    `${CONFIG.internalUrl}/claw/api/v1/agent-chat/${encodeURIComponent(grant.redispatch.agentSlug)}/chat`,
    {
      method: "POST",
      headers: { ...s2sHeaders(), "x-user-id": grant.redispatch.userId },
      body: JSON.stringify({
        message: `I've connected ${grant.host} — please continue.`,
        conversationId: grant.redispatch.conversationId,
        additionalInstructions: resumeInstructions(grant),
      }),
    },
  );
  if (!res.ok) {
    log.error(
      `[auth-grant] chat resume failed grant=${grant.grantId} status=${res.status} ${(await res.text()).slice(0, 200)}`,
    );
    return false;
  }
  return true;
}

/** Resume a run that was started from a Spaces mention. */
async function dispatchSpacesResume(grant: PendingAuthGrant): Promise<boolean> {
  const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: s2sHeaders(),
    body: JSON.stringify({
      ...grant.redispatch,
      task: resumeInstructions(grant),
      // Framed as data, not instructions.
      context: `Access to ${grant.host} was granted by the user after the previous run stopped on an auth failure.`,
      callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
      // Without this the thread shows nothing until the run finishes, so a
      // resumed task looks like the Save button did nothing.
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
    }),
  });
  if (!res.ok) {
    log.error(`[auth-grant] spaces resume failed grant=${grant.grantId} status=${res.status}`);
    return false;
  }
  return true;
}

async function dispatchResume(grant: PendingAuthGrant): Promise<boolean> {
  // A chat grant always carries an empty channelId.
  const surface = grant.redispatch.surface ?? (grant.redispatch.channelId ? "spaces" : "chat");
  const okDispatch =
    surface === "chat" ? await dispatchChatResume(grant) : await dispatchSpacesResume(grant);
  if (okDispatch) {
    log.info(`[auth-grant] resumed grant=${grant.grantId} surface=${surface} type=${grant.serverType}`);
  }
  return okDispatch;
}

/**
 * Called from every path that writes a credential. Returns how many runs were
 * resumed; fire-and-forget at the call sites.
 *
 * `conversationId` scopes the release to the one conversation the user acted
 * in, and supplying it is strongly preferred: the same host blocks several
 * chats, and granting access in one place is not consent to resume everywhere.
 * The other cards stay put and still work — pressing Save on one re-stores the
 * identical credential and resumes that thread.
 *
 * Omitting it keeps the fan-out, which is correct for the one caller with no
 * conversation: connecting from the settings page.
 */
export async function resolveAuthGrants(
  userId: string,
  serverType: string,
  opts: { conversationId?: string | undefined } = {},
): Promise<number> {
  try {
    const redis = redisService.getConnection();

    // Targeted release: address the one grant directly, touching nothing else.
    if (opts.conversationId) {
      const id = grantIdFor(userId, serverType, opts.conversationId);
      const grant = await consumeGrant(id);
      if (!grant) return 0;
      if (!(await dispatchResume(grant).catch(() => false))) {
        // Put it back so a transient dispatch failure does not lose the task.
        await redis.set(grantKey(id), JSON.stringify(grant), "EX", TTL_SECONDS).catch(() => undefined);
        return 0;
      }
      await redis.srem(indexKey(userId, serverType), id).catch(() => undefined);
      log.info(`[auth-grant] released grant=${id} conv=${opts.conversationId} (this conversation only)`);
      return 1;
    }
    const ids = await redis.smembers(indexKey(userId, serverType));
    if (ids.length === 0) return 0;

    // Anything not successfully dispatched goes back, so a transient failure
    // costs a retry rather than the task.
    let resumed = 0;
    const keep: string[] = [];
    for (const id of ids) {
      if (resumed >= MAX_RESUMES_PER_CONNECT) {
        keep.push(id);
        continue;
      }
      const grant = await consumeGrant(id);
      if (!grant) continue;
      if (await dispatchResume(grant).catch(() => false)) {
        resumed += 1;
      } else {
        await redis
          .set(grantKey(id), JSON.stringify(grant), "EX", TTL_SECONDS)
          .catch(() => undefined);
        keep.push(id);
      }
    }

    await redis.del(indexKey(userId, serverType));
    if (keep.length > 0) {
      await redis.sadd(indexKey(userId, serverType), ...keep);
      await redis.expire(indexKey(userId, serverType), TTL_SECONDS);
      log.warn(
        `[auth-grant] user=${userId} type=${serverType}: ${keep.length} run(s) left parked (cap ${MAX_RESUMES_PER_CONNECT} or dispatch failed)`,
      );
    }
    return resumed;
  } catch (err) {
    log.error(`[auth-grant] resolve failed for ${serverType}:`, err);
    return 0;
  }
}
