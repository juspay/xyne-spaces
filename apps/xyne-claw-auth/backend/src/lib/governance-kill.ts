/**
 * Kill switches: one row per switch, an epoch that moves on every set or clear, a Redis push so
 * every pod hears about it in milliseconds, and a 2 s poll of the epoch so a pod that missed the
 * push still catches up. This pod keeps one in-memory snapshot that C2, runner.callTool and run
 * admission read in microseconds; claw pods fetch the same snapshot through /internal/governance.
 * A signed break-glass entry in Redis joins every snapshot, so a platform admin can still stop an
 * org, an agent or the platform while Postgres is down.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { Redis } from "ioredis";
import {
  componentMode,
  KILL_SCOPE_KINDS,
  matchKillSwitches,
  type KillMode,
  type KillScopeKind,
  type KillSnapshot,
  type KillSwitch as SharedKillSwitch,
} from "xyne-claw-shared/governance";
import { governancePrisma } from "../db.js";
import { createLogger } from "../logger.js";
import { redisService } from "../redis.js";
import { governanceEventRow, type GovernanceEventInput } from "./governance-audit.js";

const log = createLogger("governance-kill");

export const KILL_CHANNEL = "claw:governance-kill";
export const BREAK_GLASS_KEY = "claw:governance:break-glass";
export const KILL_MODES: readonly KillMode[] = ["stop", "read_only", "ask_all"];
const POLL_MS = 2_000;

export interface KillActor {
  userId?: string | undefined;
  kind: "admin" | "trigger" | "break_glass";
  triggerKey?: string | undefined;
}
export interface SetKillInput {
  orgId: string;
  scopeKind: KillScopeKind;
  scopeId: string;
  mode: KillMode;
  reason: string;
  actor: KillActor;
  expiresAt?: Date | undefined;
}

let snapshot: KillSnapshot = { epoch: 0, takenAtMs: 0, switches: [] };
/** The last rows Postgres gave us; they keep serving, with the break-glass entry, while it is away. */
let lastRows: SharedKillSwitch[] = [];
let lastDbEpoch = 0;
let pollTimer: NodeJS.Timeout | null = null;
let subscriber: Redis | null = null;

export const currentKillSnapshot = (): KillSnapshot => snapshot;

/** Test seam. */
export function setKillSnapshotForTests(s: KillSnapshot): void {
  snapshot = s;
}

const toShared = (r: { scopeKind: string; scopeId: string; mode: string; epoch: bigint; reason: string | null; expiresAt: Date | null }): SharedKillSwitch => ({
  scopeKind: r.scopeKind as KillScopeKind,
  scopeId: r.scopeId,
  mode: (KILL_MODES as readonly string[]).includes(r.mode) ? (r.mode as KillMode) : "stop",
  epoch: Number(r.epoch),
  ...(r.reason ? { reason: r.reason } : {}),
  ...(r.expiresAt ? { expiresAtMs: r.expiresAt.getTime() } : {}),
});

async function dbKillEpoch(): Promise<number> {
  const top = await governancePrisma.killSwitch.findFirst({ orderBy: { epoch: "desc" }, select: { epoch: true } });
  return Number(top?.epoch ?? 0);
}

async function readBreakGlass(nowMs: number): Promise<{ switches: SharedKillSwitch[]; ok: boolean }> {
  try {
    return { switches: parseBreakGlass(await redisService.getConnection().get(BREAK_GLASS_KEY), process.env["GOVERNANCE_BREAK_GLASS_KEY"], nowMs), ok: true };
  } catch (err) {
    log.warn(`[governance-kill] break-glass read failed: ${err instanceof Error ? err.message : String(err)}`);
    return { switches: [], ok: false };
  }
}

/** The platform-wide epoch: the newest set, clear or break-glass entry, so one integer says whether anything changed. */
export async function currentKillEpoch(): Promise<number> {
  const [db, bg] = await Promise.all([dbKillEpoch(), readBreakGlass(Date.now())]);
  return Math.max(db, ...bg.switches.map((s) => s.epoch));
}

export function signBreakGlass(switches: readonly SharedKillSwitch[], key: string): string {
  return createHmac("sha256", key).update(JSON.stringify(switches)).digest("hex");
}

/** Break-glass entries are valid only with the platform key; a bad signature is ignored and logged. */
export function parseBreakGlass(raw: string | null, key: string | undefined, nowMs: number): SharedKillSwitch[] {
  if (!raw || !key) return [];
  try {
    const { switches, sig } = JSON.parse(raw) as { switches?: unknown; sig?: unknown };
    if (!Array.isArray(switches) || typeof sig !== "string") return [];
    const expected = signBreakGlass(switches as SharedKillSwitch[], key);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      log.error("[governance-kill] break-glass entry has a bad signature; ignored");
      return [];
    }
    return (switches as SharedKillSwitch[]).filter((s) => (KILL_SCOPE_KINDS as readonly string[]).includes(s?.scopeKind) && (KILL_MODES as readonly string[]).includes(s?.mode) && typeof s.epoch === "number" && !(typeof s.expiresAtMs === "number" && s.expiresAtMs <= nowMs));
  } catch {
    return [];
  }
}

/**
 * Every live switch plus the break-glass entry. Postgres away: the last rows it gave us keep serving
 * with a fresh break-glass read, so a break-glass stop still lands. Only when both Redis and Postgres
 * fail does the snapshot age, and decide() then refuses side effects after 10 s.
 */
export async function loadKillSnapshot(): Promise<KillSnapshot> {
  const now = new Date();
  const bg = await readBreakGlass(now.getTime());
  let dbOk = true;
  try {
    const [rows, epoch] = await Promise.all([
      governancePrisma.killSwitch.findMany({ where: { clearedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { scopeKind: true, scopeId: true, mode: true, epoch: true, reason: true, expiresAt: true } }),
      dbKillEpoch(),
    ]);
    lastRows = rows.map(toShared);
    lastDbEpoch = epoch;
  } catch (err) {
    dbOk = false;
    log.warn(`[governance-kill] postgres read failed; serving the last ${lastRows.length} switch(es) plus break-glass: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!dbOk && !bg.ok) throw new Error("neither postgres nor redis answered");
  return { epoch: Math.max(lastDbEpoch, ...bg.switches.map((s) => s.epoch)), takenAtMs: now.getTime(), switches: [...lastRows, ...bg.switches] };
}

export async function refreshKillSnapshot(): Promise<KillSnapshot> {
  try {
    const next = await loadKillSnapshot();
    if (next.epoch !== snapshot.epoch || next.switches.length !== snapshot.switches.length) log.info(`[governance-kill] snapshot epoch=${next.epoch} switches=${next.switches.length}`);
    snapshot = next;
  } catch (err) {
    // The old snapshot keeps serving; decide() refuses side effects once it is 10 s old.
    log.warn(`[governance-kill] refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return snapshot;
}

async function publish(epoch: number): Promise<void> {
  try {
    await redisService.getConnection().publish(KILL_CHANNEL, JSON.stringify({ epoch, issuedAt: Date.now() }));
  } catch (err) {
    log.warn(`[governance-kill] publish failed (pods catch up by polling): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Writes the switch and its audit event in one transaction, then tells every pod. */
export async function setKillSwitch(input: SetKillInput): Promise<{ id: string; epoch: number }> {
  if (!(KILL_SCOPE_KINDS as readonly string[]).includes(input.scopeKind)) throw new Error(`unknown scope kind ${input.scopeKind}`);
  if (!(KILL_MODES as readonly string[]).includes(input.mode)) throw new Error(`unknown mode ${input.mode}`);
  if (!input.reason.trim()) throw new Error("a reason is required");
  const epoch = Date.now();
  const row = await governancePrisma.$transaction(async (tx) => {
    const created = await tx.killSwitch.create({
      data: { orgId: input.orgId, scopeKind: input.scopeKind, scopeId: input.scopeId, mode: input.mode, reason: input.reason.trim(), setBy: input.actor.kind, setByUserId: input.actor.userId ?? null, triggerKey: input.actor.triggerKey ?? null, epoch: BigInt(epoch), expiresAt: input.expiresAt ?? null },
    });
    await tx.governanceAuditEvent.create({ data: governanceEventRow(killEvent("kill_switch_set", input.orgId, input.actor, created.id, input.scopeKind, input.scopeId, input.mode, input.reason)) });
    return created;
  });
  await refreshKillSnapshot();
  await publish(epoch);
  log.warn(`[governance-kill] set ${input.mode} on ${input.scopeKind}=${input.scopeId} by ${input.actor.kind}${input.actor.userId ? ` ${input.actor.userId}` : ""}: ${input.reason}`);
  return { id: row.id, epoch };
}

export async function clearKillSwitch(id: string, actor: KillActor, reason: string): Promise<{ epoch: number } | null> {
  if (!reason.trim()) throw new Error("a reason is required");
  const epoch = Date.now();
  const row = await governancePrisma.$transaction(async (tx) => {
    const existing = await tx.killSwitch.findUnique({ where: { id } });
    if (!existing || existing.clearedAt) return null;
    const updated = await tx.killSwitch.update({ where: { id }, data: { clearedAt: new Date(), clearedByUserId: actor.userId ?? null, clearReason: reason.trim(), epoch: BigInt(epoch) } });
    await tx.governanceAuditEvent.create({ data: governanceEventRow(killEvent("kill_switch_cleared", existing.orgId, actor, id, existing.scopeKind, existing.scopeId, existing.mode, reason)) });
    return updated;
  });
  if (!row) return null;
  await refreshKillSnapshot();
  await publish(epoch);
  log.warn(`[governance-kill] cleared ${row.mode} on ${row.scopeKind}=${row.scopeId}: ${reason}`);
  return { epoch };
}

function killEvent(eventType: "kill_switch_set" | "kill_switch_cleared" | "kill_switch_enforced", orgId: string, actor: KillActor, id: string, scopeKind: string, scopeId: string, mode: string, reason: string): GovernanceEventInput {
  return { orgId, eventType, actorKind: actor.kind === "admin" ? "admin" : "system", actorId: actor.userId ?? actor.triggerKey ?? actor.kind, subjectKind: `kill:${scopeKind}`, subjectId: scopeId, approvalId: id, decision: "block", reasonCode: `GOV-KILL-${mode.toUpperCase().replace("_", "-")}`, reasonText: reason };
}

export function listKillSwitches(orgId: string | undefined) {
  return governancePrisma.killSwitch.findMany({ where: { ...(orgId ? { orgId } : {}), OR: [{ clearedAt: null }, { clearedAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } }] }, orderBy: [{ clearedAt: "asc" }, { createdAt: "desc" }], take: 200 });
}

/** The switch that refuses a new run, if any: only stop refuses admission. */
export function killForAdmission(scopes: { orgId: string; agentSlug?: string | undefined; userId?: string | undefined }): SharedKillSwitch | null {
  if (componentMode("kill") === "off") return null;
  const top = matchKillSwitches(snapshot, { org: scopes.orgId, ...(scopes.agentSlug ? { agent: scopes.agentSlug } : {}), ...(scopes.userId ? { user: scopes.userId } : {}) }, Date.now())[0];
  return top?.mode === "stop" ? top : null;
}

/** Server and tool switches, checked inside runner.callTool for every lane. */
export function killForTool(serverType: string, tool: string): SharedKillSwitch | null {
  if (componentMode("kill") === "off") return null;
  return matchKillSwitches(snapshot, { mcp_server: serverType, tool }, Date.now())[0] ?? null;
}

export function startKillSwitchSync(): void {
  if (componentMode("kill") === "off" || pollTimer) return;
  void refreshKillSnapshot();
  const tick = (): void => {
    pollTimer = setTimeout(async () => {
      try {
        if ((await currentKillEpoch()) !== snapshot.epoch) await refreshKillSnapshot();
        else snapshot = { ...snapshot, takenAtMs: Date.now() };
      } catch {
        // The epoch could not be read: a full load decides what still answers.
        await refreshKillSnapshot();
      }
      tick();
    }, POLL_MS + Math.floor(Math.random() * 500));
    pollTimer.unref();
  };
  tick();
  try {
    subscriber = new Redis(redisService.getRedisConfig());
    subscriber.on("error", (err: Error) => log.warn(`[governance-kill] subscriber: ${err.message}`));
    subscriber.on("message", (channel: string) => { if (channel === KILL_CHANNEL) void refreshKillSnapshot(); });
    void subscriber.subscribe(KILL_CHANNEL).catch((err: Error) => log.warn(`[governance-kill] subscribe failed: ${err.message}`));
  } catch (err) {
    log.warn(`[governance-kill] no subscriber (poll only): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function stopKillSwitchSync(): Promise<void> {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  const s = subscriber;
  subscriber = null;
  if (s) await s.quit().catch(() => s.disconnect());
}
