import { Worker } from "node:worker_threads";
import path from "node:path";
import { createRequire } from "node:module";
import { PATHS } from "./config.js";
import { metric } from "./metrics.js";
import { createLogger } from "./logger.js";
import {
  OWNERSHIP_REFRESH_INTERVAL_MS,
  OWNERSHIP_REFRESH_SCRIPT,
  OWNERSHIP_TTL_SECONDS,
  OWNER_KEY_PREFIX,
  POD_ALIVE_REFRESH_INTERVAL_MS,
  POD_ALIVE_TTL_SECONDS,
  handleOwnershipLoss,
  podAliveKey,
  podName,
  setOwnershipRefreshPort,
} from "./run-ownership.js";

const log = createLogger("loop-watchdog");

export interface WatchdogConfig {
  enabled: boolean;
  stallMs: number;
  profileMs: number;
  dir: string;
}

const DEFAULT_STALL_MS = 10_000;
const DEFAULT_PROFILE_MS = 8_000;

export const MAX_CAPTURES = 10;

export const CAPTURE_SUFFIXES = ["cpuprofile", "report.json", "meta.json"] as const;

export function captureBaseName(at: Date): string {
  return `${at.toISOString().replace(/[:.]/g, "-")}-stall`;
}

const CAPTURE_FILE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-stall\.(cpuprofile|report\.json|meta\.json)$/;

export function isCaptureFileName(name: string): boolean {
  return CAPTURE_FILE_RE.test(name);
}

export function captureEpisodeOf(name: string): string | null {
  if (!isCaptureFileName(name)) return null;
  const cut = name.indexOf("-stall.");
  return name.slice(0, cut + "-stall".length);
}

export function pruneCaptureFiles(names: string[], max = MAX_CAPTURES): string[] {
  const byEpisode = new Map<string, string[]>();
  for (const name of names) {
    const episode = captureEpisodeOf(name);
    if (!episode) continue;
    const bucket = byEpisode.get(episode);
    if (bucket) bucket.push(name);
    else byEpisode.set(episode, [name]);
  }
  const episodes = [...byEpisode.keys()].sort().reverse();
  const doomed: string[] = [];
  for (const episode of episodes.slice(max)) doomed.push(...(byEpisode.get(episode) ?? []));
  return doomed.sort();
}

export type WatchdogPhase = "armed" | "capturing" | "cooldown";

export interface WatchdogState {
  phase: WatchdogPhase;
  lastCaptureAt: number;
}

export const REARM_AGE_MS = 2_000;

export function nextWatchdogAction(
  state: WatchdogState,
  heartbeatAgeMs: number,
  stallMs: number,
): "capture" | "rearm" | "none" {
  if (state.phase === "capturing") return "none";
  if (state.phase === "cooldown") return heartbeatAgeMs < REARM_AGE_MS ? "rearm" : "none";
  return heartbeatAgeMs > stallMs ? "capture" : "none";
}

export const NATIVE_BLOCK_IDLE_RATIO = 0.8;

export type BlockedIn = "javascript" | "native-or-syscall" | "unknown";

export function classifyBlockedIn(totalSamples: number, idleSamples: number): BlockedIn {
  if (totalSamples === 0) return "unknown";
  return idleSamples / totalSamples >= NATIVE_BLOCK_IDLE_RATIO ? "native-or-syscall" : "javascript";
}

export function bucketStallMs(ms: number): string {
  if (ms < 15_000) return "10s";
  if (ms < 30_000) return "15s";
  if (ms < 60_000) return "30s";
  if (ms < 120_000) return "60s";
  if (ms < 300_000) return "120s";
  return "300s+";
}

export function readWatchdogConfig(env: NodeJS.ProcessEnv = process.env): WatchdogConfig {
  const num = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    enabled: env["LOOP_WATCHDOG_ENABLED"] !== "0",
    stallMs: num(env["LOOP_WATCHDOG_STALL_MS"], DEFAULT_STALL_MS),
    profileMs: num(env["LOOP_WATCHDOG_PROFILE_MS"], DEFAULT_PROFILE_MS),
    dir: env["LOOP_WATCHDOG_DIR"] || path.join(PATHS.dataDir, "sessions", "loop-watchdog"),
  };
}

export function watchdogDir(): string {
  return readWatchdogConfig().dir;
}

const WORKER_SOURCE = String.raw`
const { workerData, parentPort } = require("node:worker_threads");
const inspector = require("node:inspector");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { sab, stallMs, profileMs, dir, rearmAgeMs, maxCaptures, idleRatio, redis } = workerData;
const clock = new BigInt64Array(sab);
setInterval(() => {}, 1000);

let redisClient = null;
const owned = new Map();

function connectRedis() {
  if (!redis || !redis.modulePath || !redis.options) return null;
  try {
    const mod = require(redis.modulePath);
    const Ctor = mod.Redis || mod.default || mod;
    const client = new Ctor(redis.options);
    client.on("error", () => {});
    return client;
  } catch (err) {
    try { console.error("[loop-watchdog] redis unavailable in worker: " + String(err && err.message)); } catch {}
    return null;
  }
}

function startRedisDuties() {
  redisClient = connectRedis();
  if (!redisClient) return;

  const touchAlive = () => {
    try {
      redisClient.set(redis.podAliveKey, String(Date.now()), "EX", redis.podAliveTtlSeconds).catch(() => {});
    } catch {}
  };
  touchAlive();
  setInterval(touchAlive, redis.podAliveIntervalMs);

  setInterval(() => {
    if (owned.size === 0) return;
    const entries = [...owned.entries()];
    try {
      const pipeline = redisClient.pipeline();
      for (const [sessionId, ownerToken] of entries) {
        pipeline.eval(redis.refreshScript, 1, redis.ownerKeyPrefix + sessionId, ownerToken, String(redis.ownershipTtlSeconds));
      }
      pipeline
        .exec()
        .then((results) => {
          if (!results) return;
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const result = results[i];
            if (!entry || !result) continue;
            if (result[0]) continue;
            if (Number(result[1]) === 1) continue;
            if (owned.get(entry[0]) !== entry[1]) continue;
            owned.delete(entry[0]);
            try { parentPort.postMessage({ type: "lost", sessionId: entry[0], ownerToken: entry[1] }); } catch {}
          }
        })
        .catch(() => {});
    } catch {}
  }, redis.ownershipIntervalMs);

  if (parentPort) {
    parentPort.on("message", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "own" && msg.sessionId && msg.ownerToken) owned.set(msg.sessionId, msg.ownerToken);
      else if (msg.type === "release" && msg.sessionId) owned.delete(msg.sessionId);
    });
    try { parentPort.postMessage({ type: "ownership-ready" }); } catch {}
  }
}

startRedisDuties();

let phase = "armed";
let stallStartedAt = 0;

function baseName(at) {
  return at.toISOString().replace(/[:.]/g, "-") + "-stall";
}

function prune() {
  try {
    const names = fs.readdirSync(dir);
    const byEpisode = new Map();
    for (const name of names) {
      const cut = name.indexOf("-stall.");
      if (cut < 0) continue;
      const episode = name.slice(0, cut + 6);
      if (!byEpisode.has(episode)) byEpisode.set(episode, []);
      byEpisode.get(episode).push(name);
    }
    const episodes = [...byEpisode.keys()].sort().reverse();
    for (const episode of episodes.slice(maxCaptures)) {
      for (const name of byEpisode.get(episode)) {
        try { fs.unlinkSync(path.join(dir, name)); } catch {}
      }
    }
  } catch {}
}

function writeMeta(base, detectedAt, ageMs, extra) {
  try {
    const mem = process.memoryUsage();
    fs.writeFileSync(
      path.join(dir, base + ".meta.json"),
      JSON.stringify(
        Object.assign(
          {
            detectedAt: detectedAt.toISOString(),
            stallMs: stallMs,
            heartbeatAgeMs: ageMs,
            pid: process.pid,
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            hostname: os.hostname(),
            podId: process.env.POD_ID || null,
          },
          extra || {},
        ),
        null,
        2,
      ),
    );
  } catch {}
}

function summarize(profile) {
  const byId = new Map();
  for (const n of profile.nodes) byId.set(n.id, n);
  let total = 0;
  let idle = 0;
  const hot = [];
  for (const n of profile.nodes) {
    const hits = n.hitCount || 0;
    if (!hits) continue;
    total += hits;
    const fn = n.callFrame.functionName || "(anonymous)";
    if (fn === "(idle)" || fn === "(program)") idle += hits;
    hot.push({ fn: fn, url: n.callFrame.url, line: n.callFrame.lineNumber, hits: hits });
  }
  hot.sort((a, b) => b.hits - a.hits);
  return {
    totalSamples: total,
    idleSamples: idle,
    blockedIn: total === 0 ? "unknown" : idle / total >= idleRatio ? "native-or-syscall" : "javascript",
    topFrames: hot.slice(0, 10),
  };
}

function writeReport(base) {
  try {
    process.report.writeReport(path.join(dir, base + ".report.json"));
    return true;
  } catch {
    return false;
  }
}

function finish(base, detectedAt, ageMs, extra) {
  writeMeta(base, detectedAt, ageMs, extra);
  prune();
  phase = "cooldown";
  try {
    console.error("[loop-watchdog] stall detected ageMs=" + ageMs + " captured=" + path.join(dir, base));
  } catch {}
}

function capture(ageMs) {
  phase = "capturing";
  const detectedAt = new Date();
  const base = baseName(detectedAt);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}

  const reportOk = writeReport(base);

  let session;
  try {
    session = new inspector.Session();
    session.connectToMainThread();
  } catch (err) {
    finish(base, detectedAt, ageMs, { profile: "unavailable", profileError: String(err && err.message), reportOk: reportOk, reportThread: "worker" });
    return;
  }

  const bail = (stage, err) => {
    try { session.disconnect(); } catch {}
    finish(base, detectedAt, ageMs, { profile: "failed", profileStage: stage, profileError: String(err && err.message), reportOk: reportOk });
  };

  try {
    session.post("Profiler.enable", (e1) => {
      if (e1) return bail("enable", e1);
      session.post("Profiler.start", (e2) => {
        if (e2) return bail("start", e2);
        setTimeout(() => {
          session.post("Profiler.stop", (e3, res) => {
            if (e3 || !res || !res.profile) return bail("stop", e3 || new Error("empty profile"));
            let wrote = false;
            try {
              fs.writeFileSync(path.join(dir, base + ".cpuprofile"), JSON.stringify(res.profile));
              wrote = true;
            } catch {}
            let summary = null;
            try { summary = summarize(res.profile); } catch {}
            try { session.disconnect(); } catch {}
            finish(base, detectedAt, ageMs, Object.assign({ profile: wrote ? "ok" : "write-failed", profileMs: profileMs, reportOk: reportOk, reportThread: "worker" }, summary || {}));
          });
        }, profileMs);
      });
    });
  } catch (err) {
    bail("post", err);
  }
}

setInterval(() => {
  try {
    const last = Number(Atomics.load(clock, 0));
    if (last === 0) return;
    const ageMs = Date.now() - last;
    if (phase === "capturing") return;
    if (phase === "cooldown") {
      if (ageMs < rearmAgeMs) {
        phase = "armed";
        if (stallStartedAt) {
          try { console.error("[loop-watchdog] loop resumed after " + (Date.now() - stallStartedAt) + "ms"); } catch {}
          stallStartedAt = 0;
        }
      }
      return;
    }
    if (ageMs > stallMs) {
      stallStartedAt = last;
      capture(ageMs);
    }
  } catch {}
}, 1000);
`;

export interface WatchdogRedisConfig {
  modulePath: string;
  options: Record<string, unknown>;
  podAliveKey: string;
  podAliveTtlSeconds: number;
  podAliveIntervalMs: number;
  ownerKeyPrefix: string;
  ownershipTtlSeconds: number;
  ownershipIntervalMs: number;
  refreshScript: string;
}

export function redisWorkerConfig(env: NodeJS.ProcessEnv = process.env): WatchdogRedisConfig | null {
  const host = env["REDIS_HOST"];
  if (!host) return null;
  let modulePath: string;
  try {
    modulePath = createRequire(import.meta.url).resolve("ioredis");
  } catch {
    return null;
  }
  return {
    modulePath,
    options: {
      host,
      port: Number(env["REDIS_PORT"] ?? 6379),
      ...(env["REDIS_PASSWORD"] ? { password: env["REDIS_PASSWORD"] } : {}),
      ...(env["REDIS_TLS"] ? { tls: { rejectUnauthorized: false } } : {}),
      connectTimeout: 3_000,
      maxRetriesPerRequest: 1,
    },
    podAliveKey: podAliveKey(podName()),
    podAliveTtlSeconds: POD_ALIVE_TTL_SECONDS,
    podAliveIntervalMs: POD_ALIVE_REFRESH_INTERVAL_MS,
    ownerKeyPrefix: OWNER_KEY_PREFIX,
    ownershipTtlSeconds: OWNERSHIP_TTL_SECONDS,
    ownershipIntervalMs: OWNERSHIP_REFRESH_INTERVAL_MS,
    refreshScript: OWNERSHIP_REFRESH_SCRIPT,
  };
}

let started = false;
let worker: Worker | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

export function startLoopWatchdog(): void {
  if (started) return;
  started = true;
  try {
    const cfg = readWatchdogConfig();
    if (!cfg.enabled) {
      log.info("[loop-watchdog] disabled via LOOP_WATCHDOG_ENABLED=0");
      return;
    }

    const sab = new SharedArrayBuffer(8);
    const clock = new BigInt64Array(sab);
    Atomics.store(clock, 0, BigInt(Date.now()));

    let previousTick = Date.now();
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const gap = now - previousTick;
      previousTick = now;
      Atomics.store(clock, 0, BigInt(now));
      if (gap > cfg.stallMs) {
        try {
          log.warn(`[loop-watchdog] main thread resumed after ${gap}ms`);
          metric.count("event_loop_stall", { ms: bucketStallMs(gap) });
          metric.observe("event_loop_stall_ms", gap);
        } catch {
        }
      }
    }, 1_000);
    heartbeatTimer.unref();

    worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        sab,
        stallMs: cfg.stallMs,
        profileMs: cfg.profileMs,
        dir: cfg.dir,
        rearmAgeMs: REARM_AGE_MS,
        maxCaptures: MAX_CAPTURES,
        idleRatio: NATIVE_BLOCK_IDLE_RATIO,
        redis: redisWorkerConfig(),
      },
    });
    const spawned = worker;
    spawned.on("message", (msg: unknown) => {
      if (!msg || typeof msg !== "object") return;
      const m = msg as { type?: string; sessionId?: string; ownerToken?: string };
      if (m.type === "ownership-ready") {
        setOwnershipRefreshPort(spawned);
        log.info("[loop-watchdog] ownership refresh moved to the watchdog thread");
        return;
      }
      if (m.type === "lost" && m.sessionId && m.ownerToken) {
        handleOwnershipLoss(m.sessionId, m.ownerToken);
      }
    });
    spawned.on("error", (err) => {
      log.warn("[loop-watchdog] worker error:", err);
      setOwnershipRefreshPort(null);
    });
    spawned.on("exit", () => {
      setOwnershipRefreshPort(null);
    });
    spawned.unref();

    log.info(
      `[loop-watchdog] armed stallMs=${cfg.stallMs} profileMs=${cfg.profileMs} dir=${cfg.dir}`,
    );
  } catch (err) {
    log.warn("[loop-watchdog] failed to start:", err);
  }
}

export function stopLoopWatchdog(): void {
  try {
    setOwnershipRefreshPort(null);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    const w = worker;
    worker = null;
    if (w) void w.terminate().catch(() => {});
  } catch {
  }
}
