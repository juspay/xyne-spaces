import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory stand-in for the agent_widget_bindings table, interpreting just the
 * Prisma shapes lib/agent-widget-binding.ts sends — so the once-per-status gate
 * is exercised through the real WHERE clause, not a re-implementation of it.
 */
type Row = Record<string, unknown> & { kind: string; screenId: string; status: string | null };
const rows = new Map<string, Row>();
const rowKey = (kind: string, screenId: string) => `${kind}:${screenId}`;
const matchesStatus = (row: Row, clause: Record<string, unknown>) => {
  if (!("status" in clause)) return true;
  const s = clause["status"];
  if (s === null) return row.status === null;
  if (s && typeof s === "object" && "not" in s) return row.status !== null && row.status !== (s as { not: string }).not;
  return row.status === s;
};
const agentWidgetBinding = {
  findUnique: vi.fn(async ({ where }: { where: { kind_screenId: { kind: string; screenId: string } } }) => {
    return rows.get(rowKey(where.kind_screenId.kind, where.kind_screenId.screenId)) ?? null;
  }),
  upsert: vi.fn(async ({ where, create, update }: { where: { kind_screenId: { kind: string; screenId: string } }; create: Row; update: Partial<Row> }) => {
    const key = rowKey(where.kind_screenId.kind, where.kind_screenId.screenId);
    const prev = rows.get(key);
    rows.set(key, prev ? { ...prev, ...update } : { ...create });
  }),
  updateMany: vi.fn(async ({ where, data }: { where: { kind: string; screenId: string; OR: Array<Record<string, unknown>> }; data: { status: string } }) => {
    const row = rows.get(rowKey(where.kind, where.screenId));
    if (!row || !where.OR.some((clause) => matchesStatus(row, clause))) return { count: 0 };
    row.status = data.status;
    return { count: 1 };
  }),
};

const enqueueOutbound = vi.fn(async (..._args: unknown[]) => undefined);
const activeRun = vi.fn(async (..._args: unknown[]) => null as { sessionId: string } | null);
const resumeTyping = vi.fn(async (..._args: unknown[]) => undefined);
const getAccount = vi.fn(async (..._args: unknown[]) => ({ id: "acc-1", orgId: "org-1", config: {} }) as unknown);
let channelConfig: Record<string, unknown> | null = null;

vi.mock("../../db.js", () => ({ prisma: { agentWidgetBinding } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./delivery.js", () => ({ enqueueOutbound }));
vi.mock("./commands.js", () => ({ activeRun }));
vi.mock("./interim.js", () => ({ resumeTyping }));
vi.mock("./store.js", () => ({
  getAccount,
  toChannelAccount: (row: { id: string; orgId: string }) => ({ ...row, channelConfig }),
}));

const {
  deliverChannelDesignShare,
  deliverChannelPrStatus,
  deliverChannelSandboxPreview,
  deliverWebhookPrStatus,
  formatDesignShareMessage,
  formatPrLinkMessage,
  formatSandboxPreviewMessage,
  readChannelPrTarget,
} = await import("./run-links.js");

// Fake values only — no real numbers, repos or hosts.
const target = {
  channel: "whatsapp-cloud",
  connectedSurfaceId: "acc-1",
  accountKey: "acct_test",
  chatId: "15550000001",
  senderId: "15550000001",
  isGroup: false,
  quoted: { chatId: "15550000001", messageId: "wamid.in" },
  statusReactions: true,
} as const;

const pr = {
  provider: "github" as const,
  title: "Fix login redirect",
  url: "https://git.example.test/acme/web/pull/12",
  repo: "acme/web",
  number: 12,
};

function sentTexts(): string[] {
  return enqueueOutbound.mock.calls.map((call) => (call[1] as { text: string }).text);
}

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
  channelConfig = null;
  getAccount.mockResolvedValue({ id: "acc-1", orgId: "org-1", config: {} });
});

describe("message formatting", () => {
  it("a PR is title, status, link", () => {
    expect(formatPrLinkMessage({ ...pr, status: "created" })).toBe(
      "**Fix login redirect**\nPR opened · acme/web #12\nhttps://git.example.test/acme/web/pull/12",
    );
    expect(formatPrLinkMessage({ title: "Bump deps", status: "merged" })).toBe("**Bump deps**\nPR merged");
  });

  it("a design share names the command and says the link stays current", () => {
    expect(formatDesignShareMessage("design", "https://spaces.example.test/claw/s/abc")).toBe(
      "**Live design**\nReady · the same link updates with later revisions in this chat\nhttps://spaces.example.test/claw/s/abc",
    );
  });

  it("a sandbox preview lists only the links it has, and says so when there is none", () => {
    expect(formatSandboxPreviewMessage({ previewUrl: "https://sbx.example.test/p" })).toBe(
      "**Live preview**\nRunning · watch the agent's browser, or take over\nBrowser: https://sbx.example.test/p",
    );
    expect(
      formatSandboxPreviewMessage({
        previewUrl: "https://sbx.example.test/p",
        codePreviewUrl: "https://sbx.example.test/c",
        termUrl: "https://sbx.example.test/t",
      }),
    ).toContain("Code changes: https://sbx.example.test/c/\nTerminal: https://sbx.example.test/t");
    expect(formatSandboxPreviewMessage(null)).toMatch(/couldn't be attached/);
  });
});

describe("delivery goes through the account outbox", () => {
  it("sends the design share as one text item to the chat", async () => {
    await deliverChannelDesignShare(target, "dashboard", "https://spaces.example.test/claw/s/abc");
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(enqueueOutbound).toHaveBeenCalledWith("acc-1", {
      kind: "text",
      chatId: "15550000001",
      text: formatDesignShareMessage("dashboard", "https://spaces.example.test/claw/s/abc"),
    });
  });

  it("puts typing back after a mid-run preview only while the run is the chat's current one", async () => {
    activeRun.mockResolvedValueOnce({ sessionId: "sess-1" });
    await deliverChannelSandboxPreview("sess-1", target, { previewUrl: "https://sbx.example.test/p" });
    expect(resumeTyping).toHaveBeenCalledTimes(1);
    activeRun.mockResolvedValueOnce({ sessionId: "sess-other" });
    await deliverChannelSandboxPreview("sess-1", target, { previewUrl: "https://sbx.example.test/p" });
    expect(resumeTyping).toHaveBeenCalledTimes(1);
  });
});

describe("PR status: at most one message per state change", () => {
  const run = { sessionId: "sess-1", target, orgId: "org-1", conversationId: "conv-1", agentSlug: "coder" };

  it("sends created once, then merged once, however often each is reported", async () => {
    await expect(deliverChannelPrStatus({ ...run, pr: { ...pr, status: "created" } })).resolves.toBe("sent");
    await expect(deliverChannelPrStatus({ ...run, pr: { ...pr, status: "created" } })).resolves.toBe("duplicate");
    await expect(deliverChannelPrStatus({ ...run, pr: { ...pr, status: "merged" } })).resolves.toBe("sent");
    await expect(deliverChannelPrStatus({ ...run, pr: { ...pr, status: "merged" } })).resolves.toBe("duplicate");
    expect(sentTexts()).toEqual([
      formatPrLinkMessage({ ...pr, status: "created" }),
      formatPrLinkMessage({ ...pr, status: "merged" }),
    ]);
  });

  it("a git-host webhook repeating what the run already sent is a no-op, a new status is sent", async () => {
    await deliverChannelPrStatus({ ...run, pr: { ...pr, status: "created" } });
    const binding = [...rows.values()][0]!;
    const stored = readChannelPrTarget(binding as never)!;
    await expect(deliverWebhookPrStatus(binding as never, stored, { ...pr, status: "created" })).resolves.toEqual({
      outcome: "skipped",
      reason: "dedup-same-status",
    });
    await expect(deliverWebhookPrStatus(binding as never, stored, { ...pr, status: "merged" })).resolves.toEqual({ outcome: "posted" });
    await expect(deliverWebhookPrStatus(binding as never, stored, { ...pr, status: "merged" })).resolves.toEqual({
      outcome: "skipped",
      reason: "dedup-same-status",
    });
    expect(enqueueOutbound).toHaveBeenCalledTimes(2);
  });

  it("stores where to send later, without the run's quoted message", async () => {
    await deliverChannelPrStatus({ ...run, pr: { ...pr, status: "created" } });
    const binding = [...rows.values()][0]!;
    expect(binding["externalKey"]).toBe("git.example.test/acme/web/pull/12");
    expect(binding["channelId"]).toBe("15550000001");
    expect(readChannelPrTarget(binding as never)).toEqual({
      channel: "whatsapp-cloud",
      connectedSurfaceId: "acc-1",
      accountKey: "acct_test",
      chatId: "15550000001",
      senderId: "15550000001",
      isGroup: false,
    });
  });

  it("a PR re-reported into another chat is sent there even at the same status", async () => {
    await deliverChannelPrStatus({ ...run, pr: { ...pr, status: "created" } });
    const otherChat = { ...target, chatId: "15550000002", senderId: "15550000002" };
    await expect(deliverChannelPrStatus({ ...run, target: otherChat, pr: { ...pr, status: "created" } })).resolves.toBe("sent");
  });

  it("a webhook for an account that moved org or is gone sends nothing", async () => {
    await deliverChannelPrStatus({ ...run, pr: { ...pr, status: "created" } });
    const binding = [...rows.values()][0]!;
    const stored = readChannelPrTarget(binding as never)!;
    enqueueOutbound.mockClear();
    getAccount.mockResolvedValueOnce({ id: "acc-1", orgId: "org-other", config: {} });
    await expect(deliverWebhookPrStatus(binding as never, stored, { ...pr, status: "merged" })).resolves.toEqual({
      outcome: "skipped",
      reason: "org-mismatch",
    });
    getAccount.mockResolvedValueOnce(null);
    await expect(deliverWebhookPrStatus(binding as never, stored, { ...pr, status: "merged" })).resolves.toEqual({
      outcome: "skipped",
      reason: "channel-account-gone",
    });
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("a binding with no org sends nothing", async () => {
    await deliverChannelPrStatus({ ...run, pr: { ...pr, status: "created" } });
    const binding = { ...[...rows.values()][0]!, orgId: "" };
    const stored = readChannelPrTarget(binding as never)!;
    enqueueOutbound.mockClear();
    await expect(deliverWebhookPrStatus(binding as never, stored, { ...pr, status: "merged" })).resolves.toEqual({
      outcome: "skipped",
      reason: "org-mismatch",
    });
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("a webhook update carries the account's notification template for a closed reply window", async () => {
    channelConfig = { notificationTemplate: { name: "claw_update", language: "en" } };
    await deliverChannelPrStatus({ ...run, pr: { ...pr, status: "created" } });
    const binding = [...rows.values()][0]!;
    enqueueOutbound.mockClear();
    await deliverWebhookPrStatus(binding as never, readChannelPrTarget(binding as never)!, { ...pr, status: "merged" });
    expect(enqueueOutbound.mock.calls[0]![1]).toMatchObject({ template: { name: "claw_update", language: "en" } });
  });
});

describe("Spaces bindings stay on the Spaces path", () => {
  it("a Spaces PR card binding has no chat target", () => {
    const spacesData = { provider: "github", title: "Fix login redirect", url: pr.url, repo: "acme/web", number: 12 };
    expect(readChannelPrTarget({ data: spacesData } as never)).toBeNull();
    expect(readChannelPrTarget({ data: null } as never)).toBeNull();
    expect(readChannelPrTarget({ data: { ...spacesData, channelDelivery: { channel: "slack", connectedSurfaceId: "x", chatId: "y" } } } as never)).toBeNull();
  });
});
