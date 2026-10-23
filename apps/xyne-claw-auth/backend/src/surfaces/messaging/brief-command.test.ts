import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
const findUnique = vi.fn();
vi.mock("../../db.js", () => ({ prisma: { user: { findUnique } } }));
const setDailyBriefWhatsappEnabled = vi.fn();
vi.mock("../../services/dailyBriefWhatsapp.js", () => ({ setDailyBriefWhatsappEnabled }));

const { parseBriefCommand, handleBriefCommand, BRIEF_OFF_TEXT, BRIEF_ON_TEXT, BRIEF_FAILED_TEXT } = await import(
  "./brief-command.js"
);

describe("parseBriefCommand", () => {
  it.each([
    ["/brief off", "off"],
    ["/BRIEF Stop", "off"],
    ["/brief on", "on"],
    [" /brief start ", "on"],
    ["/brief", "status"],
    ["/brief status", "status"],
  ])("%s -> %s", (text, expected) => {
    expect(parseBriefCommand(text)).toBe(expected);
  });

  it.each(["/briefing", "brief off", "/brief off please", "/stop", "/brief for alice off"])("ignores %s", (text) => {
    expect(parseBriefCommand(text)).toBeNull();
  });
});

describe("handleBriefCommand", () => {
  const reply = vi.fn(async (_: string) => undefined);
  beforeEach(() => vi.clearAllMocks());

  it("turns it off for the linked user only", async () => {
    await handleBriefCommand({ command: "off", userId: "linked-user", reply });
    expect(setDailyBriefWhatsappEnabled).toHaveBeenCalledWith("linked-user", false, "chat");
    expect(reply).toHaveBeenCalledWith(BRIEF_OFF_TEXT);
  });

  it("turns it back on", async () => {
    await handleBriefCommand({ command: "on", userId: "u1", reply });
    expect(setDailyBriefWhatsappEnabled).toHaveBeenCalledWith("u1", true, "chat");
    expect(reply).toHaveBeenCalledWith(BRIEF_ON_TEXT);
  });

  it("reports status without writing", async () => {
    findUnique.mockResolvedValue({ dailyBriefEnabled: true, dailyBriefWhatsappEnabled: false });
    await handleBriefCommand({ command: "status", userId: "u1", reply });
    expect(setDailyBriefWhatsappEnabled).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]?.[0]).toContain("/brief on");
  });

  it("apologises instead of throwing when the write fails", async () => {
    setDailyBriefWhatsappEnabled.mockRejectedValueOnce(new Error("db down"));
    await handleBriefCommand({ command: "off", userId: "u1", reply });
    expect(reply).toHaveBeenCalledWith(BRIEF_FAILED_TEXT);
  });
});
