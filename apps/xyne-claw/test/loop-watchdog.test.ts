import { describe, expect, it } from "vitest";
import {
  MAX_CAPTURES,
  REARM_AGE_MS,
  bucketStallMs,
  captureBaseName,
  classifyBlockedIn,
  captureEpisodeOf,
  isCaptureFileName,
  nextWatchdogAction,
  pruneCaptureFiles,
  readWatchdogConfig,
  redisWorkerConfig,
  type WatchdogState,
} from "../src/loop-watchdog.js";
import {
  OWNERSHIP_REFRESH_INTERVAL_MS,
  OWNERSHIP_TTL_SECONDS,
  POD_ALIVE_REFRESH_INTERVAL_MS,
  POD_ALIVE_TTL_SECONDS,
  podAliveKey,
  podName,
} from "../src/run-ownership.js";

function episodeFiles(iso: string): string[] {
  const base = captureBaseName(new Date(iso));
  return [`${base}.cpuprofile`, `${base}.report.json`, `${base}.meta.json`];
}

describe("captureBaseName", () => {
  it("folds colons and dots out of the ISO timestamp", () => {
    expect(captureBaseName(new Date("2026-09-03T04:11:22.333Z"))).toBe("2026-09-03T04-11-22-333Z-stall");
  });

  it("round-trips through the file-name guard", () => {
    for (const name of episodeFiles("2026-09-03T04:11:22.333Z")) {
      expect(isCaptureFileName(name)).toBe(true);
    }
  });
});

describe("isCaptureFileName", () => {
  it("rejects traversal and unrelated files", () => {
    for (const bad of [
      "../../etc/passwd",
      "2026-09-03T04-11-22-333Z-stall.cpuprofile/../../secret",
      "debug-session.json",
      "2026-09-03T04-11-22-333Z-stall.txt",
      "stall.cpuprofile",
      "",
    ]) {
      expect(isCaptureFileName(bad)).toBe(false);
    }
  });
});

describe("captureEpisodeOf", () => {
  it("groups the three files of one episode under one key", () => {
    const episodes = new Set(episodeFiles("2026-09-03T04:11:22.333Z").map(captureEpisodeOf));
    expect([...episodes]).toEqual(["2026-09-03T04-11-22-333Z-stall"]);
  });

  it("returns null for non-captures", () => {
    expect(captureEpisodeOf("debug-run-1.json")).toBeNull();
  });
});

describe("pruneCaptureFiles", () => {
  it("keeps nothing to delete below the cap", () => {
    const names = [...episodeFiles("2026-09-03T04:11:22.333Z"), ...episodeFiles("2026-09-03T05:11:22.333Z")];
    expect(pruneCaptureFiles(names)).toEqual([]);
  });

  it("deletes every file of the oldest episodes beyond the cap", () => {
    const isos = Array.from({ length: MAX_CAPTURES + 3 }, (_, i) => {
      const hour = String(i).padStart(2, "0");
      return `2026-09-03T${hour}:00:00.000Z`;
    });
    const names = isos.flatMap(episodeFiles);

    const doomed = pruneCaptureFiles(names);

    expect(doomed).toHaveLength(9);
    const survivors = names.filter((n) => !doomed.includes(n));
    expect(new Set(survivors.map(captureEpisodeOf)).size).toBe(MAX_CAPTURES);
    for (const iso of isos.slice(0, 3)) {
      for (const name of episodeFiles(iso)) expect(doomed).toContain(name);
    }
    for (const iso of isos.slice(3)) {
      for (const name of episodeFiles(iso)) expect(doomed).not.toContain(name);
    }
  });

  it("ignores foreign files in the directory", () => {
    const names = ["README.md", "debug-session.json", ...episodeFiles("2026-09-03T04:11:22.333Z")];
    expect(pruneCaptureFiles(names, 0)).toEqual(episodeFiles("2026-09-03T04:11:22.333Z").sort());
  });
});

describe("nextWatchdogAction", () => {
  const armed: WatchdogState = { phase: "armed", lastCaptureAt: 0 };
  const capturing: WatchdogState = { phase: "capturing", lastCaptureAt: 0 };
  const cooldown: WatchdogState = { phase: "cooldown", lastCaptureAt: 0 };

  it("does not fire below the stall threshold", () => {
    expect(nextWatchdogAction(armed, 9_999, 10_000)).toBe("none");
    expect(nextWatchdogAction(armed, 10_000, 10_000)).toBe("none");
  });

  it("fires once past the stall threshold", () => {
    expect(nextWatchdogAction(armed, 10_001, 10_000)).toBe("capture");
  });

  it("never re-fires while a capture is in flight", () => {
    expect(nextWatchdogAction(capturing, 300_000, 10_000)).toBe("none");
  });

  it("stays quiet through a long freeze after capturing", () => {
    expect(nextWatchdogAction(cooldown, 300_000, 10_000)).toBe("none");
  });

  it("re-arms only once the heartbeat actually recovers", () => {
    expect(nextWatchdogAction(cooldown, REARM_AGE_MS, 10_000)).toBe("none");
    expect(nextWatchdogAction(cooldown, REARM_AGE_MS - 1, 10_000)).toBe("rearm");
  });

  it("yields exactly one capture across a five-minute freeze", () => {
    let state: WatchdogState = { phase: "armed", lastCaptureAt: 0 };
    let captures = 0;
    for (let elapsed = 1_000; elapsed <= 300_000; elapsed += 1_000) {
      const action = nextWatchdogAction(state, elapsed, 10_000);
      if (action === "capture") {
        captures += 1;
        state = { phase: "cooldown", lastCaptureAt: elapsed };
      }
    }
    expect(captures).toBe(1);

    expect(nextWatchdogAction(state, 1_000, 10_000)).toBe("rearm");
  });
});

describe("classifyBlockedIn", () => {
  it("reports unknown when no samples were collected", () => {
    expect(classifyBlockedIn(0, 0)).toBe("unknown");
  });

  it("calls a busy JS loop javascript", () => {
    expect(classifyBlockedIn(2_000, 0)).toBe("javascript");
    expect(classifyBlockedIn(2_000, 400)).toBe("javascript");
  });

  it("calls a mostly-idle profile native-or-syscall", () => {
    expect(classifyBlockedIn(1_968, 1_958)).toBe("native-or-syscall");
    expect(classifyBlockedIn(1_000, 800)).toBe("native-or-syscall");
  });
});

describe("bucketStallMs", () => {
  it("buckets coarsely to bound label cardinality", () => {
    expect(bucketStallMs(10_500)).toBe("10s");
    expect(bucketStallMs(20_000)).toBe("15s");
    expect(bucketStallMs(45_000)).toBe("30s");
    expect(bucketStallMs(90_000)).toBe("60s");
    expect(bucketStallMs(200_000)).toBe("120s");
    expect(bucketStallMs(300_000)).toBe("300s+");
    expect(bucketStallMs(3_600_000)).toBe("300s+");
  });
});

describe("redisWorkerConfig", () => {
  it("is null without REDIS_HOST so the worker skips its Redis duties", () => {
    expect(redisWorkerConfig({})).toBeNull();
  });

  it("mirrors the ownership connection and carries the pod-alive contract", () => {
    const cfg = redisWorkerConfig({
      REDIS_HOST: "redis.internal",
      REDIS_PORT: "6380",
      REDIS_PASSWORD: "hunter2",
      REDIS_TLS: "1",
    });

    expect(cfg).toMatchObject({
      podAliveKey: podAliveKey(podName()),
      podAliveTtlSeconds: POD_ALIVE_TTL_SECONDS,
      podAliveIntervalMs: POD_ALIVE_REFRESH_INTERVAL_MS,
      ownerKeyPrefix: "claw:run-owner:",
      ownershipTtlSeconds: OWNERSHIP_TTL_SECONDS,
      ownershipIntervalMs: OWNERSHIP_REFRESH_INTERVAL_MS,
    });
    expect(cfg?.options).toMatchObject({
      host: "redis.internal",
      port: 6380,
      password: "hunter2",
      tls: { rejectUnauthorized: false },
    });
    expect(cfg?.modulePath).toMatch(/ioredis/);
    expect(cfg?.refreshScript).toContain("redis.call('GET', KEYS[1])");
  });

  it("refreshes the alive key well inside its own TTL", () => {
    expect(POD_ALIVE_REFRESH_INTERVAL_MS * 3).toBeLessThan(POD_ALIVE_TTL_SECONDS * 1_000);
    expect(OWNERSHIP_REFRESH_INTERVAL_MS * 3).toBeLessThan(OWNERSHIP_TTL_SECONDS * 1_000);
  });
});

describe("readWatchdogConfig", () => {
  it("defaults to enabled with the documented thresholds", () => {
    const cfg = readWatchdogConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.stallMs).toBe(10_000);
    expect(cfg.profileMs).toBe(8_000);
    expect(cfg.dir).toMatch(/sessions[/\\]loop-watchdog$/);
  });

  it("disables only on a strict '0'", () => {
    expect(readWatchdogConfig({ LOOP_WATCHDOG_ENABLED: "0" }).enabled).toBe(false);
    for (const v of ["1", "true", "", "no", "false"]) {
      expect(readWatchdogConfig({ LOOP_WATCHDOG_ENABLED: v }).enabled).toBe(true);
    }
  });

  it("honours overrides and falls back on junk", () => {
    const cfg = readWatchdogConfig({
      LOOP_WATCHDOG_STALL_MS: "30000",
      LOOP_WATCHDOG_PROFILE_MS: "2000",
      LOOP_WATCHDOG_DIR: "/tmp/wd",
    });
    expect(cfg).toMatchObject({ stallMs: 30_000, profileMs: 2_000, dir: "/tmp/wd" });

    const junk = readWatchdogConfig({ LOOP_WATCHDOG_STALL_MS: "abc", LOOP_WATCHDOG_PROFILE_MS: "-5" });
    expect(junk.stallMs).toBe(10_000);
    expect(junk.profileMs).toBe(8_000);
  });
});
