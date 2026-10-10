// Signals for a client's Xyne AI screen, sent down its page-call stream (see
// servePagePanelStream): a page call queued for one of its runs, or an artifact
// recorded in one of their conversations — so the screen acts at once, without
// asking every second.
//
// Transport: Redis pub/sub for cross-replica fan-out (the stream may sit on a
// different pod than the one that queued the call or wrote the artifact), with
// ONE pattern-subscriber connection per pod fanned out in-process, as the live
// conversation bus and device push do. No replay: the stream's heartbeat drains
// the call queue anyway, and the artifact list is fetched afresh on a signal.

import { EventEmitter } from "node:events";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("panel-signals");

const PREFIX = "claw:page-panel:";
const CALL_PREFIX = `${PREFIX}wake:`;
const ARTIFACTS_PREFIX = `${PREFIX}artifacts:`;

const local = new EventEmitter();
local.setMaxListeners(0);
let subscriberReady = false;

function ensureSubscriber(): void {
  if (subscriberReady) return;
  subscriberReady = true;
  const sub = redisService.getConnection().duplicate();
  sub
    .psubscribe(`${CALL_PREFIX}*`, `${ARTIFACTS_PREFIX}*`)
    .then(() => log.info(`[panel-signals] subscribed to ${CALL_PREFIX}* and ${ARTIFACTS_PREFIX}*`))
    .catch((err) => {
      // This connection goes, rather than linger and resubscribe beside the next
      // one — which would hear every signal twice.
      sub.disconnect();
      subscriberReady = false;
      log.error(`[panel-signals] psubscribe failed: ${errMsg(err)}`);
    });
  // The channel names the run or conversation; the local event is the channel.
  sub.on("pmessage", (_pattern: string, channel: string) => local.emit(channel));
  sub.on("error", (err: Error) => log.error(`[panel-signals] subscriber error: ${err.message}`));
}

function publish(channel: string): void {
  void redisService
    .getConnection()
    .publish(channel, "1")
    .catch((err) => log.warn(`[panel-signals] publish failed ${channel}: ${errMsg(err)}`));
}

function listen(channel: string, handler: () => void): () => void {
  ensureSubscriber();
  const listener = (): void => handler();
  local.on(channel, listener);
  return () => local.off(channel, listener);
}

/** A page call was queued for this run. */
export function signalPageCall(runId: string): void {
  publish(CALL_PREFIX + runId);
}

export function onPageCall(runId: string, handler: () => void): () => void {
  return listen(CALL_PREFIX + runId, handler);
}

/** An artifact in this conversation was added or changed. */
export function signalArtifacts(conversationId: string): void {
  publish(ARTIFACTS_PREFIX + conversationId);
}

export function onArtifacts(conversationId: string, handler: () => void): () => void {
  return listen(ARTIFACTS_PREFIX + conversationId, handler);
}
