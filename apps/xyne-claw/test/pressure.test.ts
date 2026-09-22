import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();

vi.mock("node:fs", () => ({
  readFileSync: (path: string) => {
    const v = files.get(String(path));
    if (v === undefined) throw new Error("ENOENT");
    return v;
  },
}));

vi.mock("node:os", () => ({
  default: { totalmem: () => 1000 },
  totalmem: () => 1000,
}));

const V2_CUR = "/sys/fs/cgroup/memory.current";
const V2_MAX = "/sys/fs/cgroup/memory.max";
const V1_CUR = "/sys/fs/cgroup/memory/memory.usage_in_bytes";
const V1_MAX = "/sys/fs/cgroup/memory/memory.limit_in_bytes";

async function loadPressure(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return await import("../src/pressure.js");
}

beforeEach(() => {
  files.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env["RUN_PRESSURE_MEM_HIGH_PCT"];
  delete process.env["RUN_PRESSURE_MEM_LOW_PCT"];
  delete process.env["RUN_PRESSURE_LOOP_DELAY_MS"];
});

describe("memoryPressurePct", () => {
  it("prefers cgroup v2", async () => {
    files.set(V2_MAX, "1000");
    files.set(V2_CUR, "900");
    const { memoryPressurePct } = await loadPressure();
    expect(memoryPressurePct()).toBeCloseTo(90);
  });

  it("falls back to cgroup v1 when v2 limit is 'max'", async () => {
    files.set(V2_MAX, "max");
    files.set(V2_CUR, "900");
    files.set(V1_MAX, "2000");
    files.set(V1_CUR, "500");
    const { memoryPressurePct } = await loadPressure();
    expect(memoryPressurePct()).toBeCloseTo(25);
  });

  it("treats an absurd cgroup v1 limit as unlimited and uses rss/totalmem", async () => {
    files.set(V1_MAX, String(2 ** 62));
    files.set(V1_CUR, "500");
    const { memoryPressurePct } = await loadPressure();
    const pct = memoryPressurePct();
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBe((process.memoryUsage().rss / 1000) * 100);
  });

  it("falls back to rss/totalmem when no cgroup files exist", async () => {
    const { memoryPressurePct } = await loadPressure();
    expect(memoryPressurePct()).toBeGreaterThan(0);
  });

  it("caches for ~1s", async () => {
    files.set(V2_MAX, "1000");
    files.set(V2_CUR, "300");
    const { memoryPressurePct } = await loadPressure();
    expect(memoryPressurePct()).toBeCloseTo(30);
    files.set(V2_CUR, "900");
    expect(memoryPressurePct()).toBeCloseTo(30);
    vi.advanceTimersByTime(1_500);
    expect(memoryPressurePct()).toBeCloseTo(90);
  });
});

describe("hysteresis", () => {
  it("crosses high water, stays over until below low water", async () => {
    files.set(V2_MAX, "1000");
    files.set(V2_CUR, "500");
    const { overHighWater, underLowWater, isUnderPressure } = await loadPressure({
      RUN_PRESSURE_MEM_HIGH_PCT: "85",
      RUN_PRESSURE_MEM_LOW_PCT: "70",
      RUN_PRESSURE_LOOP_DELAY_MS: "100000",
    });

    expect(overHighWater()).toBe(false);
    expect(underLowWater()).toBe(true);

    files.set(V2_CUR, "900");
    vi.advanceTimersByTime(1_500);
    expect(overHighWater()).toBe(true);
    expect(isUnderPressure()).toBe(true);
    expect(underLowWater()).toBe(false);

    files.set(V2_CUR, "800");
    vi.advanceTimersByTime(1_500);
    expect(overHighWater()).toBe(false);
    expect(underLowWater()).toBe(false);

    files.set(V2_CUR, "600");
    vi.advanceTimersByTime(1_500);
    expect(underLowWater()).toBe(true);
  });
});
