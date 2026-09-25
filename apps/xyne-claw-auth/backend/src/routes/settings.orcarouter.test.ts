// Route-level coverage for the OrcaRouter settings endpoints: the PKCE pair
// and the key-held-server-side catalog. Exercises the REAL handlers off the
// settings router, with Redis / Prisma / fetch mocked — no network, fake keys
// only. Covers contract §8's route-level requirements: success persistence,
// state mismatch, code reuse/expiry, denial/403/429/network errors, the
// degraded catalog, and that the key and verifier never reach a response.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);

const state = vi.hoisted(() => ({
  redis: new Map<string, string>(),
  cred: null as Record<string, unknown> | null,
  upserts: [] as Array<{ userId: string; provider: string; data: Record<string, unknown> }>,
  logs: [] as string[],
  fetchCalls: [] as Array<{ url: string; headers: Record<string, string> }>,
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({
    info: (...a: unknown[]) => state.logs.push(a.map(String).join(" ")),
    warn: (...a: unknown[]) => state.logs.push(a.map(String).join(" ")),
    error: (...a: unknown[]) => state.logs.push(a.map(String).join(" ")),
    debug: (...a: unknown[]) => state.logs.push(a.map(String).join(" ")),
  }),
}));

vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: async (key: string, value: string, _ex: string, _ttl: number) => {
        state.redis.set(key, value);
        return "OK";
      },
      get: async (key: string) => state.redis.get(key) ?? null,
      del: async (...keys: string[]) => {
        let had = 0;
        for (const key of keys) if (state.redis.delete(key)) had += 1;
        return had;
      },
      keys: async (pattern: string) => {
        const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
        return [...state.redis.keys()].filter((k) => k.startsWith(prefix));
      },
    }),
  },
}));

vi.mock("../repositories/index.js", () => ({
  userProviderCredentialsRepository: {
    findByUserAndProvider: vi.fn(async () => state.cred),
    upsert: vi.fn(async (userId: string, provider: string, data: Record<string, unknown>) => {
      state.upserts.push({ userId, provider, data });
      state.cred = { userId, provider, ...data };
      return state.cred;
    }),
    listByUser: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
    bindShared: vi.fn(async () => {}),
  },
  userSubagentConfigRepository: {},
  sharedProviderCredentialRepository: {},
  agentProviderCredentialsRepository: {},
}));

vi.mock("../middleware/agent-acl.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middleware/agent-acl.js")>()),
  requireRequester: (req: Request) => {
    const id = req.headers["x-user-id"];
    if (typeof id !== "string" || !id) throw new Error("x-user-id required");
    return id;
  },
  getRequesterId: (req: Request) => req.headers["x-user-id"],
  isClawAdmin: vi.fn(async () => false),
}));

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../lib/audit.js", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("../middleware/rate-limiters.js", () => ({
  oauthLimiter: (_req: Request, _res: Response, next: () => void) => next(),
}));

const { settingsRouter } = await import("./settings.js");
const { ORCAROUTER_PKCE_PREFIX, ORCAROUTER_PKCE_TTL_SECONDS } = await import("../lib/orcarouter/index.js");

type Handler = (req: Request, res: Response, next: () => void) => unknown;

function handlerFor(method: "get" | "post", path: string): Handler {
  const stack = (settingsRouter as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }>;
  }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      // Last entry is the handler; anything before it is middleware (oauthLimiter).
      const handlers = layer.route.stack;
      return handlers[handlers.length - 1]!.handle;
    }
  }
  throw new Error(`No handler for ${method.toUpperCase()} ${path}`);
}

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

// The real router wraps handlers in `asyncHandler`, which does NOT return the
// handler's promise — it forwards a rejection to `next`. So drive the handler
// and wait for whichever terminal signal arrives first (a response or an error).
async function call(
  method: "get" | "post",
  path: string,
  req: { body?: unknown; query?: Record<string, unknown>; userId?: string },
): Promise<Captured> {
  const out: Captured = { status: 200, body: {} };
  let settle: (value: Captured) => void = () => {};
  const done = new Promise<Captured>((resolve) => {
    settle = resolve;
  });

  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: Record<string, unknown>) {
      out.body = payload;
      settle(out);
      return res;
    },
  } as unknown as Response;

  const request = {
    headers: { "x-user-id": req.userId ?? "user-1" },
    body: req.body ?? {},
    query: req.query ?? {},
  } as unknown as Request;

  // Mirrors errorMiddleware: an HttpError becomes { success:false, error }.
  const next = (err?: unknown): void => {
    if (!err) {
      settle(out);
      return;
    }
    const e = err as { status?: number; message?: string };
    out.status = e.status ?? 500;
    out.body = { success: false, error: e.message ?? String(err) };
    settle(out);
  };

  await handlerFor(method, path)(request, res, next);
  return Promise.race([
    done,
    new Promise<Captured>((resolve) =>
      setTimeout(() => resolve({ status: 599, body: { error: "handler never responded" } }), 1_000),
    ),
  ]);
}

function data(captured: Captured): Record<string, unknown> {
  return captured.body["data"] as Record<string, unknown>;
}

const START = "/provider-credentials/orcarouter/oauth/start";
const EXCHANGE = "/provider-credentials/orcarouter/oauth/exchange";
const CANCEL = "/provider-credentials/orcarouter/oauth/cancel";
const MODELS = "/provider-credentials/orcarouter/models";

const FAKE_KEY = "sk-orca-fake-route-test-0001";
const FAKE_CODE = "orca-code-route-test";

function stubFetch(status: number, payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      state.fetchCalls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
    }),
  );
}

/** A stored OrcaRouter credential whose key really decrypts under the test key. */
async function storedCredential(baseUrl?: string): Promise<void> {
  const { encrypt } = await import("../crypto.js");
  const enc = encrypt(FAKE_KEY, Buffer.from("00".repeat(32), "hex"));
  state.cred = {
    userId: "user-1",
    provider: "orcarouter",
    encryptedKey: enc.ciphertext,
    iv: enc.iv,
    authTag: enc.authTag,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

beforeEach(() => {
  state.redis.clear();
  state.cred = null;
  state.upserts = [];
  state.logs = [];
  state.fetchCalls = [];
  vi.unstubAllGlobals();
});

describe("POST /provider-credentials/orcarouter/oauth/start", () => {
  it("returns a Flow B authorize URL on the auth origin and stores the verifier server-side", async () => {
    const res = await call("post", START, {});
    const body = data(res);

    expect(res.status).toBe(200);
    expect(body["flow"]).toBe("oob");
    expect(body["expiresIn"]).toBe(ORCAROUTER_PKCE_TTL_SECONDS);

    const url = new URL(String(body["url"]));
    expect(url.origin).toBe("https://www.orcarouter.ai");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("callback_url")).toBe("oob");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("api");
    expect(url.searchParams.get("state")).toBe(body["state"]);

    const stored = state.redis.get(`${ORCAROUTER_PKCE_PREFIX}user-1:${String(body["state"])}`);
    expect(stored).toBeTruthy();
    // The verifier is server-side only — never in the URL or the response.
    expect(String(body["url"])).not.toContain(stored!);
    expect(JSON.stringify(body)).not.toContain(stored!);
  });

  it("issues a fresh state (and verifier) per attempt", async () => {
    const first = data(await call("post", START, {}));
    const second = data(await call("post", START, {}));
    expect(first["state"]).not.toBe(second["state"]);
    expect(state.redis.size).toBe(2);
  });
});

describe("POST /provider-credentials/orcarouter/oauth/exchange", () => {
  async function startThenExchange(overrides: { code?: string; state?: string } = {}): Promise<Captured> {
    const started = data(await call("post", START, {}));
    return call("post", EXCHANGE, {
      body: { code: overrides.code ?? FAKE_CODE, state: overrides.state ?? started["state"] },
    });
  }

  it("persists the issued key and returns only masked state", async () => {
    stubFetch(200, { key: FAKE_KEY, user_id: "u1", scope: "api" });
    const res = await startThenExchange();

    expect(res.status).toBe(200);
    expect(data(res)).toEqual({ provider: "orcarouter", hasApiKey: true, source: "orcarouter-oauth" });
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);

    expect(state.upserts).toHaveLength(1);
    const written = state.upserts[0]!;
    expect(written.provider).toBe("orcarouter");
    expect(written.data["baseUrl"]).toBe("https://api.orcarouter.ai/v1");
    expect(written.data["authType"]).toBe("api_key");
    // Stored encrypted — the raw key is not a column value.
    expect(written.data["encryptedKey"]).not.toBe(FAKE_KEY);
    expect(written.data).not.toHaveProperty("refreshToken");
    expect(written.data).not.toHaveProperty("refresh_token");
  });

  it("sends the exchange to the auth origin with the verifier in the body only", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "api" });
    await startThenExchange();

    const call0 = state.fetchCalls[0]!;
    expect(call0.url).toBe("https://www.orcarouter.ai/api/v1/auth/keys");
    expect(call0.url).not.toContain("api.orcarouter.ai");
  });

  it("is single-use — a replayed code finds no stored verifier", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "api" });
    const started = data(await call("post", START, {}));
    const first = await call("post", EXCHANGE, { body: { code: FAKE_CODE, state: started["state"] } });
    const second = await call("post", EXCHANGE, { body: { code: FAKE_CODE, state: started["state"] } });

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(String(second.body["error"])).toMatch(/expired or the state did not match/);
    expect(state.upserts).toHaveLength(1);
  });

  it("rejects a state that was never issued (mismatch), without calling out", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "api" });
    const res = await call("post", EXCHANGE, { body: { code: FAKE_CODE, state: "never-issued-state" } });

    expect(res.status).toBe(400);
    expect(state.fetchCalls).toHaveLength(0);
    expect(state.upserts).toHaveLength(0);
  });

  it("rejects an expired attempt (verifier gone) the same way", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "api" });
    const started = data(await call("post", START, {}));
    // Simulate the 600s TTL elapsing.
    state.redis.clear();

    const res = await call("post", EXCHANGE, { body: { code: FAKE_CODE, state: started["state"] } });
    expect(res.status).toBe(400);
    expect(state.upserts).toHaveLength(0);
  });

  it("requires code and state", async () => {
    const res = await call("post", EXCHANGE, { body: {} });
    expect(res.status).toBe(400);
    expect(String(res.body["error"])).toMatch(/code and state are required/);
  });

  it("a denial is a clean 400 with an actionable message", async () => {
    stubFetch(400, { error: "access_denied", error_description: "user denied" });
    const res = await startThenExchange();
    expect(res.status).toBe(400);
    expect(String(res.body["error"])).toMatch(/denied/);
    expect(state.upserts).toHaveLength(0);
  });

  it("403 (expired/reused code) is a 400 and stores nothing", async () => {
    stubFetch(403, { error: "invalid_grant" });
    const res = await startThenExchange();
    expect(res.status).toBe(400);
    expect(state.upserts).toHaveLength(0);
  });

  it("429 (daily key cap) is a 502 so the client waits rather than retries", async () => {
    stubFetch(429, { error: "rate_limited" });
    const res = await startThenExchange();
    expect(res.status).toBe(502);
    expect(state.upserts).toHaveLength(0);
  });

  it("a network failure is a 502, not a hang and not a stored credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    const res = await startThenExchange();
    expect(res.status).toBe(502);
    expect(state.upserts).toHaveLength(0);
  });

  it("a scope downgrade stores nothing and says so", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "connector" });
    const res = await startThenExchange();
    expect(res.status).toBe(400);
    expect(String(res.body["error"])).toMatch(/connector/);
    expect(state.upserts).toHaveLength(0);
  });

  it("the verifier and the key never reach a response or a log line", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "api" });
    const started = data(await call("post", START, {}));
    const verifier = state.redis.get(`${ORCAROUTER_PKCE_PREFIX}user-1:${String(started["state"])}`)!;
    const res = await call("post", EXCHANGE, { body: { code: FAKE_CODE, state: started["state"] } });

    const everything = `${JSON.stringify(res.body)} ${state.logs.join("\n")}`;
    expect(everything).not.toContain(verifier);
    expect(everything).not.toContain(FAKE_KEY);
  });

  it("tolerates the user pasting the whole URL they were shown", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "api" });
    const started = data(await call("post", START, {}));
    const res = await call("post", EXCHANGE, {
      body: { code: `https://www.orcarouter.ai/auth/callback?code=${FAKE_CODE}&state=${String(started["state"])}` },
    });
    expect(res.status).toBe(200);
    expect(data(res)["hasApiKey"]).toBe(true);
  });
});

describe("POST /provider-credentials/orcarouter/oauth/cancel", () => {
  it("releases the named attempt so its code can never be redeemed", async () => {
    const started = data(await call("post", START, {}));
    const key = `${ORCAROUTER_PKCE_PREFIX}user-1:${String(started["state"])}`;
    expect(state.redis.has(key)).toBe(true);

    const res = await call("post", CANCEL, { body: { state: started["state"] } });

    expect(res.status).toBe(200);
    expect(state.redis.has(key)).toBe(false);
    // The abandoned code now fails exactly like an expired one — no exchange.
    stubFetch(200, { key: FAKE_KEY, scope: "api" });
    const after = await call("post", EXCHANGE, { body: { code: FAKE_CODE, state: started["state"] } });
    expect(after.status).toBe(400);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it("clears this user's pending attempts when the client has no state yet", async () => {
    const first = data(await call("post", START, {}));
    const second = data(await call("post", START, {}));
    const otherUser = data(await call("post", START, { userId: "user-2" }));

    const res = await call("post", CANCEL, { body: {} });

    expect(res.status).toBe(200);
    expect(state.redis.has(`${ORCAROUTER_PKCE_PREFIX}user-1:${String(first["state"])}`)).toBe(false);
    expect(state.redis.has(`${ORCAROUTER_PKCE_PREFIX}user-1:${String(second["state"])}`)).toBe(false);
    // Another user's in-flight sign-in is untouched.
    expect(state.redis.has(`${ORCAROUTER_PKCE_PREFIX}user-2:${String(otherUser["state"])}`)).toBe(true);
  });

  it("is idempotent — cancelling twice is not an error", async () => {
    const started = data(await call("post", START, {}));
    expect((await call("post", CANCEL, { body: { state: started["state"] } })).status).toBe(200);
    expect((await call("post", CANCEL, { body: { state: started["state"] } })).status).toBe(200);
    expect((await call("post", CANCEL, { body: {} })).status).toBe(200);
  });
});

describe("GET /provider-credentials/orcarouter/models", () => {
  it("serves the verified seed with degraded:true when no key is stored yet", async () => {
    const res = await call("get", MODELS, {});
    expect(res.status).toBe(200);
    expect(data(res)).toMatchObject({ source: "fallback", degraded: true, capability: "chat" });
    expect(state.fetchCalls).toHaveLength(0);
    const models = data(res)["models"] as Array<Record<string, unknown>>;
    expect(models.map((m) => m.id)).toContain("openai/gpt-5.5");
  });

  it("serves live models (source live, not degraded) and holds the key server-side", async () => {
    await storedCredential("https://api.orcarouter.ai/v1");

    stubFetch(200, {
      data: [
        {
          id: "live/model-a",
          supported_endpoint_types: ["openai"],
          architecture: { input_modalities: ["text"] },
        },
      ],
    });

    const res = await call("get", MODELS, {});
    expect(data(res)).toMatchObject({ source: "live", degraded: false, capability: "chat" });
    expect((data(res)["models"] as Array<{ id: string }>).map((m) => m.id)).toEqual(["live/model-a"]);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);

    // Fetched from the inference origin, never the auth origin, and scoped to
    // the capability being selected.
    expect(state.fetchCalls[0]?.url).toBe("https://api.orcarouter.ai/v1/models?capability=chat");
    expect(state.fetchCalls[0]?.headers["Authorization"]).toBe(`Bearer ${FAKE_KEY}`);
  });

  it("degrades to the seed when the upstream call fails", async () => {
    await storedCredential();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    const res = await call("get", MODELS, {});
    expect(data(res)).toMatchObject({ source: "fallback", degraded: true });
    expect(state.logs.join("\n")).not.toContain(FAKE_KEY);
  });

  it("degrades when upstream returns a non-ok status", async () => {
    await storedCredential();
    stubFetch(500, { error: "boom" });
    const res = await call("get", MODELS, {});
    expect(data(res)).toMatchObject({ source: "fallback", degraded: true });
  });

  it("degrades when upstream returns junk rather than a catalog", async () => {
    await storedCredential();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "not json at all",
      } as unknown as Response)),
    );
    const res = await call("get", MODELS, {});
    expect(data(res)).toMatchObject({ source: "fallback", degraded: true });
  });

  it("applies the capability filter on the fallback path", async () => {
    const res = await call("get", MODELS, { query: { capability: "chat", modalities: "video" } });
    expect((data(res)["models"] as Array<{ id: string }>).map((m) => m.id)).toEqual(["google/gemini-3.5-flash"]);
    expect(data(res)["capability"]).toBe("chat");
  });

  it("returns an empty list (not an error) for a capability the seed cannot serve", async () => {
    const res = await call("get", MODELS, { query: { capability: "embedding" } });
    expect(res.status).toBe(200);
    expect(data(res)["models"]).toEqual([]);
    expect(data(res)).toMatchObject({ source: "fallback", degraded: true });
  });

  it("never returns a key or an endpoint list in the payload", async () => {
    const res = await call("get", MODELS, {});
    const models = data(res)["models"] as Array<Record<string, unknown>>;
    for (const model of models) {
      expect(Object.keys(model).sort()).toEqual(expect.arrayContaining(["id", "name"]));
      expect(model).not.toHaveProperty("endpoints");
      expect(model).not.toHaveProperty("apiKey");
    }
    expect(JSON.stringify(res.body)).not.toContain("sk-orca-");
  });
});
