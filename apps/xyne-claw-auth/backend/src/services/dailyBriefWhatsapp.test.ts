import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  spacesAppUrl: "https://spaces.example/",
  dailyBriefWhatsappDisabled: false,
  dailyBriefWhatsappOrgs: [] as string[],
}));
vi.mock("../config.js", () => ({ CONFIG: config }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../repositories/index.js", () => ({ DAILY_BRIEF_KIND: "DAILY_BRIEF" }));
const recordDelivery = vi.fn();
const recordOptChange = vi.fn();
vi.mock("../otel/daily-brief-metrics.js", () => ({
  recordDailyBriefWhatsappDelivery: recordDelivery,
  recordDailyBriefWhatsappOptChange: recordOptChange,
}));
vi.mock("./dailyBrief.js", () => ({ briefDateBucket: () => "2026-10-10" }));

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  generatedContent: { findUnique: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("../db.js", () => ({ prisma: db }));
const notifyUser = vi.fn();
vi.mock("../surfaces/messaging/agent-tools.js", () => ({ notifyUser }));

const {
  renderBriefForWhatsApp,
  briefTemplateText,
  briefUrl,
  deliverDailyBriefToWhatsapp,
  setDailyBriefWhatsappEnabled,
  WHATSAPP_BRIEF_MAX_CHARS,
  BRIEF_OPT_OUT_HINT,
} = await import("./dailyBriefWhatsapp.js");

const brief = (over: Record<string, string[]> = {}) => ({
  generated_for: "u1",
  date: "Sat, 10 Oct",
  what_needs_you: [],
  overdue: [],
  waiting_on_others: [],
  assigned_to_you: [],
  todays_schedule: [],
  ...over,
});

describe("renderBriefForWhatsApp", () => {
  const url = "https://spaces.example/ai/daily-brief/2026-10-10";

  it("stays under the ceiling and keeps the link and opt-out hint", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Item ${i} ${"x".repeat(300)}`);
    const out = renderBriefForWhatsApp(
      brief({ what_needs_you: long, overdue: long, waiting_on_others: long, todays_schedule: long }),
      url,
    );
    expect(out.length).toBeLessThanOrEqual(WHATSAPP_BRIEF_MAX_CHARS);
    expect(out).toContain(url);
    expect(out).toContain(BRIEF_OPT_OUT_HINT);
    expect(out).toMatch(/\+\d+ more in the full brief/);
  });

  it("shows at most three items per section and counts the rest", () => {
    const out = renderBriefForWhatsApp(brief({ overdue: ["a", "b", "c", "d", "e"] }), url);
    expect(out.match(/^• /gm)).toHaveLength(3);
    expect(out).toContain("+2 more in the full brief.");
  });

  it("strips markdown links to their label", () => {
    const out = renderBriefForWhatsApp(brief({ overdue: ["Fix [XYNE-1](https://x/y) today"] }), url);
    expect(out).toContain("• Fix XYNE-1 today");
    expect(out).not.toContain("https://x/y");
  });

  it("says so when nothing needs the user", () => {
    expect(renderBriefForWhatsApp(brief(), url)).toContain("Nothing needs you this morning.");
  });
});

describe("briefTemplateText / briefUrl", () => {
  it("summarises counts and the link", () => {
    const text = briefTemplateText(brief({ what_needs_you: ["a", "b"], overdue: ["c"] }), "L");
    expect(text).toBe("2 need you, 1 overdue. Full brief: L");
  });
  it("normalises a trailing slash on the app url", () => {
    expect(briefUrl("2026-10-10")).toBe("https://spaces.example/ai/daily-brief/2026-10-10");
  });
});

describe("deliverDailyBriefToWhatsapp", () => {
  const readyRow = { id: "gc1", orgId: "org1", status: "ready", data: brief({ overdue: ["a"] }), whatsappDeliveredAt: null };

  beforeEach(() => {
    vi.clearAllMocks();
    config.dailyBriefWhatsappDisabled = false;
    config.dailyBriefWhatsappOrgs = [];
    db.user.findUnique.mockResolvedValue({ dailyBriefEnabled: true, dailyBriefWhatsappEnabled: true });
    db.generatedContent.findUnique.mockResolvedValue(readyRow);
    db.generatedContent.updateMany.mockResolvedValue({ count: 1 });
    notifyUser.mockResolvedValue({ ok: true, viaTemplate: false });
  });

  it("sends once and keeps the claim", async () => {
    const res = await deliverDailyBriefToWhatsapp("u1", "2026-10-10");
    expect(res).toEqual({ outcome: "sent", retry: false });
    expect(notifyUser).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", orgId: "org1", templateKind: "dailyBrief" }));
    expect(db.generatedContent.updateMany).toHaveBeenCalledTimes(1); // claim only, no release
    expect(recordDelivery).toHaveBeenCalledWith("sent");
  });

  it("reports a template send", async () => {
    notifyUser.mockResolvedValue({ ok: true, viaTemplate: true });
    expect((await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).outcome).toBe("template");
  });

  it("skips when another job already claimed the day", async () => {
    db.generatedContent.updateMany.mockResolvedValue({ count: 0 });
    expect((await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).outcome).toBe("duplicate_skipped");
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("skips when already delivered", async () => {
    db.generatedContent.findUnique.mockResolvedValue({ ...readyRow, whatsappDeliveredAt: new Date() });
    expect((await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).outcome).toBe("duplicate_skipped");
  });

  it("releases the claim and retries on a transient failure", async () => {
    notifyUser.mockResolvedValue({ ok: false, error: "boom", reason: "failed" });
    expect(await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).toEqual({ outcome: "failed", retry: true });
    expect(db.generatedContent.updateMany).toHaveBeenCalledTimes(2);
  });

  it("releases the claim and retries when the send throws", async () => {
    notifyUser.mockRejectedValue(new Error("net"));
    expect(await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).toEqual({ outcome: "failed", retry: true });
    expect(db.generatedContent.updateMany).toHaveBeenCalledTimes(2);
  });

  it("does not retry a closed window or a missing target", async () => {
    notifyUser.mockResolvedValue({ ok: false, error: "x", reason: "window_closed" });
    expect(await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).toEqual({ outcome: "window_closed", retry: false });
    notifyUser.mockResolvedValue({ ok: false, error: "x", reason: "no_target" });
    expect(await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).toEqual({ outcome: "no_target", retry: false });
  });

  it("honours opt-out, the kill switch, the allowlist and staleness", async () => {
    db.user.findUnique.mockResolvedValueOnce({ dailyBriefEnabled: true, dailyBriefWhatsappEnabled: false });
    expect((await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).outcome).toBe("opted_out");

    config.dailyBriefWhatsappDisabled = true;
    expect((await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).outcome).toBe("disabled");
    config.dailyBriefWhatsappDisabled = false;

    config.dailyBriefWhatsappOrgs = ["other-org"];
    expect((await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).outcome).toBe("disabled");
    config.dailyBriefWhatsappOrgs = [];

    expect((await deliverDailyBriefToWhatsapp("u1", "2026-10-09")).outcome).toBe("stale");
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("retries while the brief is still being regenerated", async () => {
    db.generatedContent.findUnique.mockResolvedValue({ ...readyRow, status: "generating" });
    expect(await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).toEqual({ outcome: "missing", retry: true });
  });

  it("does not retry when there is no brief at all", async () => {
    db.generatedContent.findUnique.mockResolvedValue(null);
    expect(await deliverDailyBriefToWhatsapp("u1", "2026-10-10")).toEqual({ outcome: "missing", retry: false });
  });
});

describe("setDailyBriefWhatsappEnabled", () => {
  beforeEach(() => vi.clearAllMocks());
  it("records a metric only on an actual change", async () => {
    db.user.findUnique.mockResolvedValue({ dailyBriefWhatsappEnabled: true });
    await setDailyBriefWhatsappEnabled("u1", false, "chat");
    expect(recordOptChange).toHaveBeenCalledWith(false, "chat");
    recordOptChange.mockClear();
    await setDailyBriefWhatsappEnabled("u1", true, "settings");
    expect(recordOptChange).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1" },
      data: expect.objectContaining({ dailyBriefWhatsappEnabled: true }),
    }));
  });
});
