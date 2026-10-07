/**
 * Durable AgentRun bookkeeping for the two interactive chat surfaces
 * (routes/agent-chat.ts and routes/run-stream.ts).
 *
 * Both surfaces used to write the AgentRun row only AFTER a successful dispatch,
 * keyed on a sessionId the dispatch call itself minted. Everything that failed in
 * between — claw unreachable, an SSE stream that closed before `started`, a throw
 * in the pre-dispatch window, or the fire-and-forget insert simply rejecting —
 * left a conversation holding chat_messages and no run at all. Those turns were
 * invisible to GET /runs/paged, and invisible to orphan-run-finalizer too, which
 * only repairs rows that already exist. The assistant placeholder then sat at
 * "running" forever.
 *
 * The id is now minted BEFORE dispatch (prepareRun honours a caller-supplied
 * sessionId on internal runs — see lib/start-run.ts) and the row is written
 * before the wire, so a run that never starts is still a run that can be seen,
 * reported and reaped.
 *
 * Contract for callers:
 *   mintChatSessionId()  → put it in the dispatch body AND pass it to beginChatRun
 *   beginChatRun()       → AWAIT it; a turn whose run cannot be recorded must not run
 *   failChatRun()        → every exit path between begin and a terminal callback
 *   discardChatRun()     → only for deferred/lock-skip, where another run owns the turn
 */
import { randomUUID } from "node:crypto";
import { agentRunRepository } from "../repositories/index.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("chat-run-record");

export interface BeginChatRunInput {
  sessionId: string;
  userId: string;
  agentSlug: string;
  orgId: string;
  task: string;
  conversationId: string;
}

/** Mint the session id for a chat turn. Must satisfy prepareRun's
 *  `/^[A-Za-z0-9_-]{1,128}$/` guard for internal runs, which a UUID does. */
export function mintChatSessionId(): string {
  return randomUUID();
}

function publishCc(event: Record<string, unknown>): void {
  redisService
    .getConnection()
    .publish("cc:events", JSON.stringify(event))
    .catch(() => {});
}

/**
 * Insert the run row for a chat turn, before dispatch.
 *
 * Deliberately NOT fire-and-forget: this used to be
 * `.catch((e) => log.warn(...))` at every call site, which made a lost run row
 * indistinguishable from no traffic at all. Callers await it and abort the turn
 * if it throws — telling the user their message failed is strictly better than
 * silently running a turn nothing will ever record.
 */
export async function beginChatRun(input: BeginChatRunInput): Promise<void> {
  await agentRunRepository.start({
    sessionId: input.sessionId,
    userId: input.userId,
    agentSlug: input.agentSlug,
    orgId: input.orgId,
    triggerSource: "chat",
    task: input.task,
    conversationId: input.conversationId,
  });
  publishCc({ type: "agent_start", sessionId: input.sessionId, agentSlug: input.agentSlug });
}

/**
 * Mark a pre-created run failed because the turn never reached (or never
 * returned from) the agent. Safe to call on a session that was never inserted —
 * finalize is an updateMany under the hood, so a missing row is a no-op.
 */
export async function failChatRun(sessionId: string, error: unknown): Promise<void> {
  try {
    const message = typeof error === "string" ? error : errMsg(error);
    // Guarded on status "running": a late failure path (the outer catch firing
    // after the result callback already landed) must not flip a completed run.
    const closed = await agentRunRepository.failIfRunning(sessionId, message);
    if (closed === 0) return;
    log.info(`[chat-run-record] closed un-dispatched run ${sessionId}: ${message.slice(0, 200)}`);
    publishCc({ type: "agent_done", sessionId, status: "failed" });
  } catch (err) {
    log.warn(`[chat-run-record] failChatRun(${sessionId}) failed: ${errMsg(err)}`);
  }
}

/**
 * Drop a pre-created run row entirely.
 *
 * Only for the deferred / lock-skip case: claw refused this dispatch because
 * another worker already owns the conversation, and THAT run has its own row and
 * will deliver the answer. Recording this one as "failed" would invent a failed
 * run for every duplicate dispatch and make the agent look far less reliable
 * than it is.
 */
export async function discardChatRun(sessionId: string): Promise<void> {
  try {
    await agentRunRepository.deleteBySessionId(sessionId);
    publishCc({ type: "agent_done", sessionId, status: "cancelled" });
  } catch (err) {
    log.warn(`[chat-run-record] discardChatRun(${sessionId}) failed: ${errMsg(err)}`);
  }
}
