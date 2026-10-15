import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { redisService } from "../redis.js";
import { hasActiveRunRecovery, getRecoveryRootSessionId } from "../queue/run-recovery-worker.js";
import { errMsg } from "./errors.js";

const log = createLogger("agent-run-queue");

export const WRITE_AUTOMATION_MAX_CONCURRENT = 3;
export const AGENT_RUN_QUEUE_CAP = Number(process.env["CLAW_AGENT_RUN_QUEUE_CAP"] ?? "200");
const SLOT_LEASE_MS = Number(process.env["CLAW_AGENT_RUN_SLOT_TTL_MS"] ?? String(3 * 60 * 60 * 1000));
const UNDISPATCHED_GRACE_MS = 10 * 60 * 1000;
const DRAIN_INTERVAL_MS = Number(process.env["CLAW_AGENT_RUN_QUEUE_DRAIN_MS"] ?? "30000");
const MAX_DISPATCH_ATTEMPTS = 3;

const REGISTRY_KEY = "claw:agent-runq:agents";
const slotsKey = (agentKey: string) => `claw:agent-runq:slots:${agentKey}`;
const queueKey = (agentKey: string) => `claw:agent-runq:queue:${agentKey}`;
const payloadsKey = (agentKey: string) => `claw:agent-runq:payloads:${agentKey}`;

export interface QueuedAutomationRun {
  sessionId: string;
  agentSlug: string;
  orgId: string | null;
  body: Record<string, unknown>;
  enqueuedAt: number;
  attempts: number;
}

export interface AutomationDispatchOutcome {
  status: number;
  body: unknown;
}

export type AutomationRunDispatcher = (run: QueuedAutomationRun) => Promise<AutomationDispatchOutcome>;

let dispatcher: AutomationRunDispatcher | null = null;

export function setAutomationRunDispatcher(fn: AutomationRunDispatcher | null): void {
  dispatcher = fn;
}

export function agentRunQueueKey(orgId: string | null | undefined, agentSlug: string): string {
  return `${orgId ?? "global"}:${agentSlug}`;
}

export function isWriteAutomationAgent(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  return (config as Record<string, unknown>)["allowWriteInReadOnlyJob"] === true;
}

const ADMIT_LUA = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
if redis.call("ZSCORE", KEYS[1], ARGV[4]) or redis.call("ZCARD", KEYS[1]) < tonumber(ARGV[3]) then
  redis.call("ZADD", KEYS[1], ARGV[2], ARGV[4])
  redis.call("SADD", KEYS[2], ARGV[5])
  return 1
end
return 0
`;

const ENQUEUE_LUA = `
if redis.call("HEXISTS", KEYS[2], ARGV[1]) == 1 or redis.call("ZSCORE", KEYS[3], ARGV[1]) then
  return -1
end
if redis.call("LLEN", KEYS[1]) >= tonumber(ARGV[3]) then
  return -2
end
redis.call("HSET", KEYS[2], ARGV[1], ARGV[2])
redis.call("SADD", KEYS[4], ARGV[4])
return redis.call("RPUSH", KEYS[1], ARGV[1])
`;

const POP_LUA = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[3]) then
  return false
end
while true do
  local sid = redis.call("LPOP", KEYS[2])
  if not sid then
    return false
  end
  local item = redis.call("HGET", KEYS[3], sid)
  redis.call("HDEL", KEYS[3], sid)
  if item then
    redis.call("ZADD", KEYS[1], ARGV[2], sid)
    return item
  end
end
`;

const REBIND_LUA = `
local score = redis.call("ZSCORE", KEYS[1], ARGV[1])
if not score then
  return 0
end
redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("ZADD", KEYS[1], score, ARGV[2])
return 1
`;

export async function admitAutomationRun(agentKey: string, sessionId: string): Promise<boolean> {
  const now = Date.now();
  try {
    const granted = await redisService
      .getConnection()
      .eval(
        ADMIT_LUA,
        2,
        slotsKey(agentKey),
        REGISTRY_KEY,
        now,
        now + SLOT_LEASE_MS,
        WRITE_AUTOMATION_MAX_CONCURRENT,
        sessionId,
        agentKey,
      );
    return granted === 1;
  } catch (err) {
    log.warn(`admit failed agent=${agentKey} session=${sessionId} — failing open: ${errMsg(err)}`);
    return true;
  }
}

export async function rebindAutomationRun(agentKey: string, fromId: string, toSessionId: string): Promise<void> {
  try {
    await redisService.getConnection().eval(REBIND_LUA, 1, slotsKey(agentKey), fromId, toSessionId);
  } catch (err) {
    log.warn(`rebind failed agent=${agentKey} from=${fromId} to=${toSessionId}: ${errMsg(err)}`);
  }
}

export async function enqueueAutomationRun(
  agentKey: string,
  run: QueuedAutomationRun,
): Promise<{ enqueued: boolean; deduped: boolean; full: boolean; position: number }> {
  const result = Number(
    await redisService
      .getConnection()
      .eval(
        ENQUEUE_LUA,
        4,
        queueKey(agentKey),
        payloadsKey(agentKey),
        slotsKey(agentKey),
        REGISTRY_KEY,
        run.sessionId,
        JSON.stringify(run),
        AGENT_RUN_QUEUE_CAP,
        agentKey,
      ),
  );
  if (result === -1) return { enqueued: false, deduped: true, full: false, position: 0 };
  if (result === -2) return { enqueued: false, deduped: false, full: true, position: 0 };
  return { enqueued: true, deduped: false, full: false, position: result };
}

async function freeSlots(agentKey: string, sessionIds: string[]): Promise<void> {
  if (sessionIds.length > 0) await redisService.getConnection().zrem(slotsKey(agentKey), ...sessionIds);
}

export async function releaseAutomationRun(agentKey: string, sessionId: string): Promise<void> {
  try {
    await freeSlots(agentKey, [sessionId]);
  } catch (err) {
    log.warn(`release failed agent=${agentKey} session=${sessionId}: ${errMsg(err)}`);
  }
  scheduleAgentRunQueueDrain();
}

async function runSettled(sessionId: string, claimedAt: number): Promise<boolean> {
  if (await getRecoveryRootSessionId(sessionId)) {
    return !(await hasActiveRunRecovery(sessionId));
  }
  const row = await prisma.agentRun.findUnique({ where: { sessionId }, select: { status: true } });
  if (row) return row.status !== "running";
  return Date.now() - claimedAt > UNDISPATCHED_GRACE_MS;
}

async function releaseSettled(agentKey: string): Promise<void> {
  const flat = await redisService.getConnection().zrange(slotsKey(agentKey), 0, -1, "WITHSCORES");
  const checks: Promise<string | null>[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const sessionId = flat[i]!;
    const claimedAt = Number(flat[i + 1]) - SLOT_LEASE_MS;
    checks.push(runSettled(sessionId, claimedAt).then((done) => (done ? sessionId : null), () => null));
  }
  const settled = (await Promise.all(checks)).filter((id): id is string => id !== null);
  if (settled.length === 0) return;
  await freeSlots(agentKey, settled);
  log.info(`released settled runs agent=${agentKey} sessions=${settled.join(",")}`);
}

function classifyDispatch(outcome: AutomationDispatchOutcome): "dispatched" | "handed_off" | "failed" {
  if (outcome.status < 200 || outcome.status >= 300) return "failed";
  const body = typeof outcome.body === "string" ? safeJson(outcome.body) : outcome.body;
  const queued = Boolean(body && typeof body === "object" && (body as { queued?: unknown }).queued === true);
  return queued ? "handed_off" : "dispatched";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function requeueAtHead(agentKey: string, run: QueuedAutomationRun): Promise<void> {
  await redisService
    .getConnection()
    .multi()
    .hset(payloadsKey(agentKey), run.sessionId, JSON.stringify(run))
    .lpush(queueKey(agentKey), run.sessionId)
    .exec();
}

async function dispatchNext(agentKey: string): Promise<boolean> {
  if (!dispatcher) return false;
  const now = Date.now();
  const raw = await redisService
    .getConnection()
    .eval(
      POP_LUA,
      3,
      slotsKey(agentKey),
      queueKey(agentKey),
      payloadsKey(agentKey),
      now,
      now + SLOT_LEASE_MS,
      WRITE_AUTOMATION_MAX_CONCURRENT,
    );
  if (typeof raw !== "string") return false;
  const run = JSON.parse(raw) as QueuedAutomationRun;
  let outcome: AutomationDispatchOutcome;
  try {
    outcome = await dispatcher(run);
  } catch (err) {
    outcome = { status: 500, body: { error: errMsg(err) } };
  }
  const kind = classifyDispatch(outcome);
  if (kind === "dispatched") {
    log.info(`dispatched queued run agent=${agentKey} session=${run.sessionId} waitedMs=${now - run.enqueuedAt}`);
    return true;
  }
  await freeSlots(agentKey, [run.sessionId]);
  if (kind === "handed_off") {
    log.info(`queued run moved to its conversation queue agent=${agentKey} session=${run.sessionId}`);
    return true;
  }
  if (outcome.status >= 500 && run.attempts + 1 < MAX_DISPATCH_ATTEMPTS) {
    await requeueAtHead(agentKey, { ...run, attempts: run.attempts + 1 });
    log.warn(`dispatch failed, requeued agent=${agentKey} session=${run.sessionId} status=${outcome.status}`);
    return false;
  }
  log.error(
    `dropped queued run agent=${agentKey} session=${run.sessionId} status=${outcome.status} body=${JSON.stringify(outcome.body).slice(0, 200)}`,
  );
  return true;
}

const draining = new Set<string>();

async function drainAgent(agentKey: string): Promise<void> {
  if (draining.has(agentKey)) return;
  draining.add(agentKey);
  try {
    await releaseSettled(agentKey);
    while (await dispatchNext(agentKey)) {}
    const redis = redisService.getConnection();
    const [active, waiting] = await Promise.all([redis.zcard(slotsKey(agentKey)), redis.llen(queueKey(agentKey))]);
    if (active === 0 && waiting === 0) await redis.srem(REGISTRY_KEY, agentKey);
  } catch (err) {
    log.warn(`drain failed agent=${agentKey}: ${errMsg(err)}`);
  } finally {
    draining.delete(agentKey);
  }
}

export async function drainAgentRunQueues(): Promise<void> {
  const agents = await redisService.getConnection().smembers(REGISTRY_KEY).catch(() => [] as string[]);
  await Promise.all(agents.map(drainAgent));
}

let pendingDrain: ReturnType<typeof setTimeout> | null = null;

export function scheduleAgentRunQueueDrain(delayMs = 2000): void {
  if (pendingDrain) return;
  pendingDrain = setTimeout(() => {
    pendingDrain = null;
    void drainAgentRunQueues();
  }, delayMs);
  pendingDrain.unref?.();
}

let interval: ReturnType<typeof setInterval> | null = null;

export function initAgentRunQueue(): void {
  if (interval) return;
  interval = setInterval(() => void drainAgentRunQueues(), DRAIN_INTERVAL_MS);
  interval.unref?.();
}

export function closeAgentRunQueue(): void {
  if (interval) clearInterval(interval);
  interval = null;
  if (pendingDrain) clearTimeout(pendingDrain);
  pendingDrain = null;
}
