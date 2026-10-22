import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);

/**
 * Just enough Redis for a challenge: strings, hashes, TTLs against Date.now()
 * (so fake timers expire keys), and MULTI returning [err, value] pairs.
 */
const fake = vi.hoisted(() => {
  const data = new Map<string, { value: string | Map<string, string>; expiresAt: number | null }>();
  const live = (key: string) => {
    const entry = data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) data.delete(key);
    return data.get(key);
  };
  const hash = (key: string) => {
    const entry = live(key);
    if (entry) return entry.value as Map<string, string>;
    const value = new Map<string, string>();
    data.set(key, { value, expiresAt: null });
    return value;
  };
  const ops = {
    async incr(key: string) {
      const entry = live(key);
      const next = Number((entry?.value as string | undefined) ?? 0) + 1;
      data.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    async expire(key: string, seconds: number) {
      const entry = live(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    },
    async del(key: string) {
      return live(key) ? (data.delete(key), 1) : 0;
    },
    async hset(key: string, fields: Record<string, string>) {
      const h = hash(key);
      for (const [field, value] of Object.entries(fields)) h.set(field, value);
      return Object.keys(fields).length;
    },
    async hget(key: string, field: string) {
      return (live(key)?.value as Map<string, string> | undefined)?.get(field) ?? null;
    },
    async hincrby(key: string, field: string, by: number) {
      const h = hash(key);
      const next = Number(h.get(field) ?? 0) + by;
      h.set(field, String(next));
      return next;
    },
  };
  type Op = keyof typeof ops;
  const multi = () => {
    const queued: Array<() => Promise<unknown>> = [];
    const chain: Record<string, unknown> = {
      async exec() {
        const out: Array<[null, unknown]> = [];
        for (const run of queued) out.push([null, await run()]);
        return out;
      },
    };
    for (const name of Object.keys(ops) as Op[]) {
      chain[name] = (...args: unknown[]) => {
        queued.push(() => (ops[name] as (...a: unknown[]) => Promise<unknown>)(...args));
        return chain;
      };
    }
    return chain;
  };
  return { data, client: { ...ops, multi } };
});
vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => fake.client } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./agent-tools.js", () => ({
  isRunning: (account: { config: { desiredState?: string; connState?: string } }) =>
    account.config.desiredState === "running" && account.config.connState !== "logged_out",
}));
const enqueueAndWait = vi.fn();
vi.mock("./delivery.js", () => ({ enqueueAndWait }));

type FakePlugin = { key: string; accountScope: "org" | "user"; senderIdFromPhone?: (phone: string) => string | null };
let channels: FakePlugin[] = [];
let accountsByChannel: Record<string, unknown[]> = {};
vi.mock("./plugin.js", () => ({ listChannels: () => channels }));
vi.mock("./store.js", () => ({
  listOrgAccounts: async (key: string) => accountsByChannel[key] ?? [],
  toChannelAccount: (row: unknown) => row,
}));

const {
  CODE_TTL_S,
  CODES_PER_NUMBER,
  CODES_PER_USER,
  MAX_ATTEMPTS,
  checkCode,
  codeMessage,
  findCodeSender,
  issueCode,
  sendCode,
  withdrawCode,
} = await import("./number-verification.js");

// Obviously fake numbers (555-01xx is reserved for fiction).
const claim = { orgId: "org-test", userId: "user-a", digits: "15555550123" };

async function issued(over: Partial<typeof claim> = {}): Promise<string> {
  const result = await issueCode({ ...claim, ...over });
  if (!result.ok) throw new Error("expected a code");
  return result.code;
}

beforeEach(() => {
  fake.data.clear();
  enqueueAndWait.mockReset();
  channels = [];
  accountsByChannel = {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issueCode / checkCode", () => {
  it("accepts the code it sent, once", async () => {
    const code = await issued();
    expect(code).toMatch(/^\d{6}$/);
    expect(await checkCode(claim, code)).toEqual({ outcome: "ok" });
    // Single use: the same code again finds nothing.
    expect(await checkCode(claim, code)).toEqual({ outcome: "expired" });
  });

  it("stores only a hash of the code, never the code itself", async () => {
    const code = await issued();
    const stored = JSON.stringify([...fake.data.values()].map((entry) => [...(entry.value instanceof Map ? entry.value : [])]));
    expect(stored).not.toContain(code);
    expect([...fake.data.keys()].join(" ")).not.toContain(claim.digits);
  });

  it("expires after CODE_TTL_S", async () => {
    vi.useFakeTimers();
    const code = await issued();
    vi.advanceTimersByTime((CODE_TTL_S - 1) * 1000);
    const stillLive = await issued({ userId: "user-b" });
    vi.advanceTimersByTime(2 * 1000);
    expect(await checkCode(claim, code)).toEqual({ outcome: "expired" });
    // The other challenge, issued later, is still good — expiry is per code.
    expect(await checkCode({ ...claim, userId: "user-b" }, stillLive)).toEqual({ outcome: "ok" });
  });

  it("counts wrong codes down, then burns the challenge so even the right code fails", async () => {
    const code = await issued();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let left = MAX_ATTEMPTS - 1; left > 0; left--) {
      expect(await checkCode(claim, wrong)).toEqual({ outcome: "wrong", attemptsLeft: left });
    }
    expect(await checkCode(claim, wrong)).toEqual({ outcome: "locked" });
    expect(await checkCode(claim, code)).toEqual({ outcome: "expired" });
  });

  it("only the newest code works", async () => {
    const first = await issued();
    let second = await issued();
    while (second === first) second = await issued();
    expect((await checkCode(claim, first)).outcome).toBe("wrong");
    expect(await checkCode(claim, second)).toEqual({ outcome: "ok" });
  });

  it("is bound to the user who asked: the same code is worthless to anyone else", async () => {
    const code = await issued();
    expect(await checkCode({ ...claim, userId: "user-b" }, code)).toEqual({ outcome: "expired" });
    expect(await checkCode({ ...claim, orgId: "org-other" }, code)).toEqual({ outcome: "expired" });
    expect(await checkCode(claim, code)).toEqual({ outcome: "ok" });
  });

  it("leaves no stray key behind when checking a code nobody asked for", async () => {
    expect(await checkCode(claim, "123456")).toEqual({ outcome: "expired" });
    expect(fake.data.size).toBe(0);
  });

  it("withdrawCode drops a challenge whose code never went out", async () => {
    const code = await issued();
    await withdrawCode(claim);
    expect(await checkCode(claim, code)).toEqual({ outcome: "expired" });
  });
});

describe("rate limits", () => {
  it("caps codes per number, whoever asks", async () => {
    for (let i = 0; i < CODES_PER_NUMBER.max; i++) await issued({ userId: `user-${i}` });
    expect(await issueCode({ ...claim, userId: "user-late" })).toEqual({ ok: false, reason: "rate_limited", scope: "number" });
  });

  it("caps codes per user, whatever number they try", async () => {
    for (let i = 0; i < CODES_PER_USER.max; i++) await issued({ digits: `155555501${String(i).padStart(2, "0")}` });
    expect(await issueCode({ ...claim, digits: "15555550199" })).toEqual({ ok: false, reason: "rate_limited", scope: "user" });
  });

  it("a user out of budget does not also spend the number's", async () => {
    for (let i = 0; i < CODES_PER_USER.max; i++) await issued({ userId: "greedy", digits: `155555501${String(i).padStart(2, "0")}` });
    await issueCode({ ...claim, userId: "greedy" });
    // The real owner can still get a code for their number.
    expect((await issueCode(claim)).ok).toBe(true);
  });

  it("the window resets", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < CODES_PER_NUMBER.max; i++) await issued({ userId: `user-${i}` });
    expect((await issueCode(claim)).ok).toBe(false);
    vi.advanceTimersByTime(CODES_PER_NUMBER.windowS * 1000 + 1);
    expect((await issueCode(claim)).ok).toBe(true);
  });
});

describe("findCodeSender / sendCode", () => {
  const running = { config: { desiredState: "running", connState: "connected" }, channelConfig: {} };

  it("never sends from a personal number, whose owner could read the code", async () => {
    channels = [{ key: "whatsapp", accountScope: "user", senderIdFromPhone: (p) => `${p.replace(/\D/g, "")}@s.whatsapp.net` }];
    accountsByChannel = { whatsapp: [{ id: "personal", ...running }] };
    expect(await findCodeSender("org-test")).toBeNull();
  });

  it("uses a running business number, with its template for a shut reply window", async () => {
    channels = [{ key: "whatsapp-cloud", accountScope: "org", senderIdFromPhone: (p) => p.replace(/\D/g, "") }];
    const template = { name: "fake_update", language: "en" };
    accountsByChannel = {
      "whatsapp-cloud": [
        { id: "stopped", config: { desiredState: "stopped", connState: "disconnected" }, channelConfig: {} },
        { id: "biz", ...running, channelConfig: { notificationTemplate: template } },
      ],
    };
    const sender = await findCodeSender("org-test");
    expect(sender).toMatchObject({ account: { id: "biz" }, template });

    enqueueAndWait.mockResolvedValue({ ok: true });
    expect(await sendCode(sender!, claim.digits, "123456")).toEqual({ ok: true });
    expect(enqueueAndWait).toHaveBeenCalledWith("biz", {
      kind: "text",
      chatId: claim.digits,
      text: codeMessage("123456"),
      markdown: false,
      template,
    });
  });

  it("reports a send the messenger refused", async () => {
    channels = [{ key: "whatsapp-cloud", accountScope: "org", senderIdFromPhone: (p) => p.replace(/\D/g, "") }];
    accountsByChannel = { "whatsapp-cloud": [{ id: "biz", ...running }] };
    enqueueAndWait.mockResolvedValue({ ok: false, error: "boom" });
    expect(await sendCode((await findCodeSender("org-test"))!, claim.digits, "123456")).toEqual({ ok: false, error: "boom" });
  });
});
