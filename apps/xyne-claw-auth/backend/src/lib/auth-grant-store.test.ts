import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    store,
    sets,
    fetch: vi.fn(),
    redis: {
      set: vi.fn(async (k: string, v: string) => { store.set(k, v); return "OK"; }),
      getdel: vi.fn(async (k: string) => { const v = store.get(k) ?? null; store.delete(k); return v; }),
      sadd: vi.fn(async (k: string, m: string) => { (sets.get(k) ?? sets.set(k, new Set()).get(k)!).add(m); return 1; }),
      smembers: vi.fn(async (k: string) => [...(sets.get(k) ?? [])]),
      srem: vi.fn(async (k: string, m: string) => { sets.get(k)?.delete(m); return 1; }),
      del: vi.fn(async (k: string) => { sets.delete(k); return 1; }),
      expire: vi.fn(async () => 1),
    },
  };
});

vi.mock("../redis.js", () => ({ redisService: { getConnection: () => mocks.redis } }));
vi.mock("../config.js", () => ({
  CONFIG: { internalUrl: "http://claw-auth.internal", xyneClawS2sKey: "s2s" },
}));

const { registerAuthGrant, resolveAuthGrants } = await import("./auth-grant-store.js");

const base = {
  userId: "u1",
  serverType: "github",
  providerLabel: "GitHub",
  host: "api.github.com",
  url: "https://api.github.com/repos/o/r/stargazers",
  redispatch: {
    userId: "u1",
    task: "who starred juspay/xyne-spaces?",
    agentSlug: "orchestrator",
    orgId: "org1",
    conversationId: "conv1",
    channelId: "chan1",
  },
};

describe("auth grant store", () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.sets.clear();
    mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("parks a run and resumes it on connect, replaying the original task", async () => {
    await registerAuthGrant(base);
    const resumed = await resolveAuthGrants("u1", "github");

    expect(resumed).toBe(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe("http://claw-auth.internal/claw/api/v1/internal/run");
    expect(init.headers["x-s2s-key"]).toBe("s2s");

    const body = JSON.parse(init.body) as Record<string, string>;
    expect(body.task).toContain("just granted access to GitHub");
    expect(body.task).toContain("https://api.github.com/repos/o/r/stargazers");
    // No reasonText here, so it falls back to the run task.
    expect(body.task).toContain("who starred juspay/xyne-spaces?");
    expect(body.conversationId).toBe("conv1");
    expect(body.agentSlug).toBe("orchestrator");
  });

  it("replays the AGENT's stated goal, not the turn that triggered the block", async () => {
    // Live failure: the run task was "dont you ahve a request access tool?" —
    // the user's last message — while the real goal was two messages earlier.
    await registerAuthGrant({
      ...base,
      reasonText: "listing branches on bitbucket.juspay.net — got a login page instead",
      redispatch: { ...base.redispatch, task: "dont you ahve a request access tool?" },
    });
    await resolveAuthGrants("u1", "github");

    const body = JSON.parse((mocks.fetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, string>;
    expect(body.task).toContain("listing branches on bitbucket.juspay.net");
    expect(body.task).not.toContain("dont you ahve a request access tool?");
  });

  it("is idempotent per conversation — three blocked URLs produce one resume", async () => {
    await registerAuthGrant(base);
    await registerAuthGrant({ ...base, url: "https://api.github.com/other" });
    await registerAuthGrant({ ...base, url: "https://api.github.com/third" });

    expect(await resolveAuthGrants("u1", "github")).toBe(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("cannot double-dispatch when connect fires twice", async () => {
    await registerAuthGrant(base);
    expect(await resolveAuthGrants("u1", "github")).toBe(1);
    expect(await resolveAuthGrants("u1", "github")).toBe(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not resume a different user or a different connector", async () => {
    await registerAuthGrant(base);
    expect(await resolveAuthGrants("someone-else", "github")).toBe(0);
    expect(await resolveAuthGrants("u1", "slack")).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("never stores a credential", async () => {
    await registerAuthGrant(base);
    const stored = [...mocks.store.values()].join("");
    expect(stored).not.toMatch(/token|secret|Bearer|password/i);
  });

  it("survives a dispatch failure without throwing", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await registerAuthGrant(base);
    await expect(resolveAuthGrants("u1", "github")).resolves.toBe(0);
  });
});

/**
 * Which door a resumed run comes back through.
 *
 * Every resume used to go to `/internal/run` with the SPACES callback URL. For
 * a run started from claw's own chat that delivered the answer somewhere the
 * chat never reads — the work ran, and the user saw nothing appear. And for
 * Spaces it sent no `progressUrl`, so the thread showed no activity at all
 * between pressing Save and the final message landing.
 */
describe("resume routing by surface", () => {
  const chatGrant = {
    userId: "u1",
    serverType: "webfetch-host:mcp.canva.com",
    providerLabel: "mcp.canva.com",
    host: "mcp.canva.com",
    url: "https://mcp.canva.com/mcp",
    reasonText: "reading the design",
    redispatch: {
      userId: "u1",
      task: "read this design",
      agentSlug: "orchestrator",
      orgId: "org1",
      conversationId: "conv-chat",
      channelId: "",
      surface: "chat" as const,
    },
  };

  beforeEach(() => {
    mocks.store.clear();
    mocks.sets.clear();
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("sends a chat-started run back through the chat endpoint, not the Spaces webhook", async () => {
    await registerAuthGrant(chatGrant);
    await resolveAuthGrants("u1", "webfetch-host:mcp.canva.com");

    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://claw-auth.internal/claw/api/v1/agent-chat/orchestrator/chat");
    expect(url).not.toContain("/internal/run");

    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body["conversationId"]).toBe("conv-chat");
    // Short and in the user's voice; the machinery rides out of sight.
    expect(body["message"]).toBe("I've connected mcp.canva.com — please continue.");
    expect(body["additionalInstructions"]).toContain("https://mcp.canva.com/mcp");
    expect(body["additionalInstructions"]).toContain("reading the design");
    // Acting user must be pinned, or the chat endpoint cannot tell who this is for.
    expect((init.headers as Record<string, string>)["x-user-id"]).toBe("u1");
  });

  it("sends a Spaces-started run to /internal/run WITH a progressUrl", async () => {
    await registerAuthGrant({
      ...chatGrant,
      redispatch: { ...chatGrant.redispatch, channelId: "chan1", surface: "spaces" as const },
    });
    await resolveAuthGrants("u1", "webfetch-host:mcp.canva.com");

    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/internal/run");
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    // Missing progressUrl is why the thread looked frozen after Save.
    expect(body["progressUrl"]).toContain("/webhook/progress");
    expect(body["callbackUrl"]).toContain("/webhook/result");
  });

  it("infers the surface for a grant parked before the field existed", async () => {
    const { surface: _drop, ...legacy } = chatGrant.redispatch;
    await registerAuthGrant({ ...chatGrant, redispatch: legacy });
    await resolveAuthGrants("u1", "webfetch-host:mcp.canva.com");
    // Empty channelId was always the chat marker; keep honouring it.
    expect(String(mocks.fetch.mock.calls[0]?.[0])).toContain("/agent-chat/");
  });
});

/**
 * One answer releases one conversation.
 *
 * Several chats blocked on the same host park several grants. Releasing all of
 * them meant answering one card silently restarted every other conversation —
 * agents the user had moved on from ran again, spending tokens on work nobody
 * asked for twice, in threads they were not looking at.
 */
describe("release is scoped to the conversation the user acted in", () => {
  const grantFor = (conversationId: string) => ({
    userId: "u1",
    serverType: "webfetch-host:api.example.net",
    providerLabel: "api.example.net",
    host: "api.example.net",
    url: "https://api.example.net/thing",
    redispatch: {
      userId: "u1",
      task: "do the thing",
      agentSlug: "orchestrator",
      orgId: "org1",
      conversationId,
      channelId: "",
      surface: "chat" as const,
    },
  });

  beforeEach(() => {
    mocks.store.clear();
    mocks.sets.clear();
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("resumes only the named conversation and leaves the others parked", async () => {
    await registerAuthGrant(grantFor("conv-a"));
    await registerAuthGrant(grantFor("conv-b"));
    await registerAuthGrant(grantFor("conv-c"));

    const resumed = await resolveAuthGrants("u1", "webfetch-host:api.example.net", {
      conversationId: "conv-b",
    });

    expect(resumed).toBe(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((mocks.fetch.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, string>;
    expect(body["conversationId"]).toBe("conv-b");

    // The other two are still available — their cards keep working.
    expect(
      await resolveAuthGrants("u1", "webfetch-host:api.example.net", { conversationId: "conv-a" }),
    ).toBe(1);
    expect(
      await resolveAuthGrants("u1", "webfetch-host:api.example.net", { conversationId: "conv-c" }),
    ).toBe(1);
  });

  it("is a no-op for a conversation with nothing parked", async () => {
    await registerAuthGrant(grantFor("conv-a"));
    expect(
      await resolveAuthGrants("u1", "webfetch-host:api.example.net", { conversationId: "conv-zzz" }),
    ).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
    // …and conv-a is untouched by the miss.
    expect(
      await resolveAuthGrants("u1", "webfetch-host:api.example.net", { conversationId: "conv-a" }),
    ).toBe(1);
  });

  it("re-parks the grant when the targeted dispatch fails", async () => {
    await registerAuthGrant(grantFor("conv-a"));
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "down" });

    expect(
      await resolveAuthGrants("u1", "webfetch-host:api.example.net", { conversationId: "conv-a" }),
    ).toBe(0);
    // A transient failure must not eat the task.
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    expect(
      await resolveAuthGrants("u1", "webfetch-host:api.example.net", { conversationId: "conv-a" }),
    ).toBe(1);
  });

  it("still fans out when no conversation is given", async () => {
    // The settings-page connect has no conversation, and releasing everything
    // waiting on that connector is exactly what the user meant there.
    await registerAuthGrant(grantFor("conv-a"));
    await registerAuthGrant(grantFor("conv-b"));
    expect(await resolveAuthGrants("u1", "webfetch-host:api.example.net")).toBe(2);
  });
});
