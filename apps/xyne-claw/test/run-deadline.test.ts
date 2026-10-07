import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_RUN_MS, RUN_TIMED_OUT, describeFetchError, maxRunMs, raceRunDeadline } from "../src/run-deadline.js";

describe("maxRunMs", () => {
  it("reads RUN_QUEUE_MAX_RUN_MS and falls back to three hours", () => {
    expect(maxRunMs("60000")).toBe(60000);
    expect(maxRunMs(undefined)).toBe(DEFAULT_MAX_RUN_MS);
    expect(maxRunMs("0")).toBe(DEFAULT_MAX_RUN_MS);
    expect(maxRunMs("abc")).toBe(DEFAULT_MAX_RUN_MS);
  });
});

describe("raceRunDeadline", () => {
  it("returns the run's own result when it finishes first", async () => {
    expect(await raceRunDeadline(Promise.resolve("completed"), 1000)).toBe("completed");
  });

  it("gives up on a run that never settles", async () => {
    expect(await raceRunDeadline(new Promise<never>(() => {}), 10)).toBe(RUN_TIMED_OUT);
  });

  it("passes a run's rejection through", async () => {
    await expect(raceRunDeadline(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });
});

describe("describeFetchError", () => {
  it("adds the undici cause that fetch hides behind 'fetch failed'", () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:3003"), { code: "ECONNREFUSED" }) });
    expect(describeFetchError(err)).toBe("fetch failed (cause: ECONNREFUSED connect ECONNREFUSED 10.0.0.1:3003)");
  });

  it("keeps plain errors and non-errors readable", () => {
    expect(describeFetchError(new Error("HTTP 500"))).toBe("HTTP 500");
    expect(describeFetchError("x")).toBe("x");
  });
});
