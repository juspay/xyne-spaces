import { describe, expect, it, vi } from "vitest";

import {
  applyOrcaRouterFailure,
  classifyExchangeError,
  classifyOrcaRouterFailure,
  createInMemoryCredentialStateStore,
  isNeedsReauth,
  OrcaRouterNoRefreshGrantError,
  ORCAROUTER_REFRESH_GRANT_AVAILABLE,
  refreshOrcaRouterCredential,
} from "./errors.js";
import { OrcaRouterExchangeError } from "./pkce.js";

describe("classifyOrcaRouterFailure — inference relay", () => {
  it("classifies a 401 as needsReauth: terminal, and NOT refreshable", () => {
    const failure = classifyOrcaRouterFailure({ surface: "inference", status: 401 });
    expect(failure.kind).toBe("needsReauth");
    expect(failure.terminal).toBe(true);
    expect(failure.refreshable).toBe(false);
    expect(failure.retryable).toBe(false);
    expect(isNeedsReauth(failure)).toBe(true);
  });

  it("never marks a 401 as retryable — no retry loop on a revoked key", () => {
    expect(classifyOrcaRouterFailure({ surface: "inference", status: 401 }).retryable).toBe(false);
  });

  it("keeps a 403 non-terminal and a 400 non-terminal", () => {
    expect(classifyOrcaRouterFailure({ surface: "inference", status: 403 })).toMatchObject({
      kind: "forbidden",
      terminal: false,
      refreshable: false,
    });
    expect(classifyOrcaRouterFailure({ surface: "inference", status: 400 })).toMatchObject({
      kind: "invalidRequest",
      terminal: false,
    });
  });

  it("treats 429 and 5xx as retryable but not reauth", () => {
    expect(classifyOrcaRouterFailure({ surface: "inference", status: 429 })).toMatchObject({
      kind: "rateLimited",
      retryable: true,
      terminal: false,
    });
    expect(classifyOrcaRouterFailure({ surface: "inference", status: 503 })).toMatchObject({
      kind: "unavailable",
      retryable: true,
    });
  });

  it("classifies a transport failure (no status) as unavailable", () => {
    expect(classifyOrcaRouterFailure({ surface: "inference" })).toMatchObject({
      kind: "unavailable",
      retryable: true,
    });
  });

  it("quotes a sanitized upstream detail without inventing one", () => {
    const failure = classifyOrcaRouterFailure({
      surface: "inference",
      status: 400,
      detail: "unknown model",
    });
    expect(failure.message).toContain("unknown model");
  });
});

describe("classifyOrcaRouterFailure — exchange", () => {
  it("a denial is terminal and never retryable", () => {
    expect(classifyOrcaRouterFailure({ surface: "exchange", error: "access_denied" })).toMatchObject({
      kind: "denied",
      terminal: true,
      retryable: false,
    });
  });

  it("403 (expired/reused) and 400 (downgrade) are terminal", () => {
    expect(classifyOrcaRouterFailure({ surface: "exchange", status: 403 })).toMatchObject({
      kind: "expiredOrReused",
      terminal: true,
    });
    expect(classifyOrcaRouterFailure({ surface: "exchange", status: 400 })).toMatchObject({
      kind: "badRequest",
      terminal: true,
    });
  });

  it("429 is retryable — the daily key cap is a wait, not a dead end", () => {
    expect(classifyOrcaRouterFailure({ surface: "exchange", status: 429 })).toMatchObject({
      kind: "rateLimited",
      retryable: true,
      terminal: false,
    });
  });

  it("a network failure or 5xx is retryable and says nothing was saved", () => {
    expect(classifyOrcaRouterFailure({ surface: "exchange" })).toMatchObject({
      kind: "unavailable",
      retryable: true,
    });
    expect(classifyOrcaRouterFailure({ surface: "exchange", status: 502 }).message).toMatch(/Nothing was saved/);
  });
});

describe("classifyExchangeError", () => {
  it("maps a scope downgrade to a terminal scopeDowngrade", () => {
    const failure = classifyExchangeError(
      new OrcaRouterExchangeError(undefined, "granted connector", "scope"),
    );
    expect(failure).toMatchObject({ kind: "scopeDowngrade", terminal: true, refreshable: false });
  });

  it("maps every exchange reason onto a kind", () => {
    const cases: Array<[ConstructorParameters<typeof OrcaRouterExchangeError>[2], string]> = [
      ["denied", "denied"],
      ["expired_or_reused", "expiredOrReused"],
      ["bad_request", "badRequest"],
      ["rate_limited", "rateLimited"],
      ["network", "unavailable"],
      ["malformed", "unknown"],
    ];
    for (const [reason, kind] of cases) {
      const failure = classifyExchangeError(new OrcaRouterExchangeError(undefined, "m", reason));
      expect(failure.kind).toBe(kind);
      expect(failure.refreshable).toBe(false);
    }
  });

  it("classifies an unrelated thrown value as unknown, not as reauth", () => {
    expect(classifyExchangeError(new Error("boom"))).toMatchObject({ kind: "unknown", terminal: false });
    expect(classifyExchangeError("boom")).toMatchObject({ kind: "unknown" });
  });
});

describe("applyOrcaRouterFailure — generation-safe needsReauth", () => {
  const account = { userId: "u1", provider: "orcarouter" };

  it("marks the exact generation that made the rejected request", async () => {
    const store = createInMemoryCredentialStateStore([{ ...account, generation: 7 }]);
    const result = await applyOrcaRouterFailure(
      classifyOrcaRouterFailure({ surface: "inference", status: 401 }),
      { ...account, generation: 7 },
      store,
    );
    expect(result.applied).toBe(true);
    expect(result.refreshed).toBe(false);
    expect(store.marked).toEqual([{ ...account, generation: 7 }]);
  });

  it("a STALE generation never marks a newer credential", async () => {
    const store = createInMemoryCredentialStateStore([{ ...account, generation: 9 }]);
    const result = await applyOrcaRouterFailure(
      classifyOrcaRouterFailure({ surface: "inference", status: 401 }),
      { ...account, generation: 7 },
      store,
    );
    expect(result).toMatchObject({ applied: false, reason: "stale-generation", refreshed: false });
    expect(store.marked).toEqual([]);
  });

  it("does not mark a different account", async () => {
    const store = createInMemoryCredentialStateStore([{ userId: "u2", provider: "orcarouter", generation: 3 }]);
    const result = await applyOrcaRouterFailure(
      classifyOrcaRouterFailure({ surface: "inference", status: 401 }),
      { ...account, generation: 3 },
      store,
    );
    expect(result).toMatchObject({ applied: false, reason: "no-credential" });
    expect(store.marked).toEqual([]);
  });

  it("does not mark anything for a non-reauth failure", async () => {
    const store = createInMemoryCredentialStateStore([{ ...account, generation: 1 }]);
    for (const status of [429, 403, 400, 503]) {
      const result = await applyOrcaRouterFailure(
        classifyOrcaRouterFailure({ surface: "inference", status }),
        { ...account, generation: 1 },
        store,
      );
      expect(result).toMatchObject({ applied: false, reason: "not-terminal" });
    }
    expect(store.marked).toEqual([]);
  });

  it("a reauthorized credential (new generation) survives the old request's late 401", async () => {
    // Generation 1 is rejected; the user re-authorizes (generation 2) before the
    // failure is applied. The late failure must not poison the new credential.
    const store = createInMemoryCredentialStateStore([{ ...account, generation: 2 }]);
    const late = await applyOrcaRouterFailure(
      classifyOrcaRouterFailure({ surface: "inference", status: 401 }),
      { ...account, generation: 1 },
      store,
    );
    expect(late.applied).toBe(false);
    expect(store.marked).toEqual([]);

    // A 401 against the CURRENT generation still marks it.
    const current = await applyOrcaRouterFailure(
      classifyOrcaRouterFailure({ surface: "inference", status: 401 }),
      { ...account, generation: 2 },
      store,
    );
    expect(current.applied).toBe(true);
    expect(store.marked).toEqual([{ ...account, generation: 2 }]);
  });

  it("awaits an async store too", async () => {
    const markNeedsReauth = vi.fn(async () => {});
    const store = {
      currentGeneration: async () => 4,
      markNeedsReauth,
    };
    const result = await applyOrcaRouterFailure(
      classifyOrcaRouterFailure({ surface: "inference", status: 401 }),
      { ...account, generation: 4 },
      store,
    );
    expect(result.applied).toBe(true);
    expect(markNeedsReauth).toHaveBeenCalledWith({ ...account, generation: 4 });
  });
});

describe("no fake refresh", () => {
  it("declares that no refresh grant exists", () => {
    expect(ORCAROUTER_REFRESH_GRANT_AVAILABLE).toBe(false);
  });

  it("refuses to refresh instead of inventing a grant", async () => {
    await expect(refreshOrcaRouterCredential()).rejects.toBeInstanceOf(OrcaRouterNoRefreshGrantError);
    await expect(refreshOrcaRouterCredential()).rejects.toThrow(/durable API key, not a refreshable token/);
  });

  it("never reports refreshed:true on any path", async () => {
    const store = createInMemoryCredentialStateStore([{ userId: "u", provider: "orcarouter", generation: 1 }]);
    for (const status of [401, 403, 429, 500, undefined]) {
      const result = await applyOrcaRouterFailure(
        classifyOrcaRouterFailure({ surface: "inference", status }),
        { userId: "u", provider: "orcarouter", generation: 1 },
        store,
      );
      expect(result.refreshed).toBe(false);
    }
  });
});
