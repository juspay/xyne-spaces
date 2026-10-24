import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock("./webhook.js", () => ({ getSession: getSessionMock }));

const { slackSurfaceRequester } = await import("./mcp.js");

// Fake ids only.
const surfaceCreds = {
  credentials: { botToken: "xoxb-fake-token", teamId: "TFAKE" },
  source: "agent" as const,
  connectionId: "slack-surface:surface-agent-1:TFAKE",
  isUserOwned: false,
};

beforeEach(() => getSessionMock.mockReset());

describe("slackSurfaceRequester", () => {
  it("scopes a Slack-surface run to the Slack user who started it", async () => {
    getSessionMock.mockResolvedValue({ slackDelivery: { slackUserId: "UREQUESTER" } });
    expect(await slackSurfaceRequester(surfaceCreds, "sess")).toEqual({ slackUserId: "UREQUESTER" });
  });

  it("still scopes (to nobody) when the run context is missing", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await slackSurfaceRequester(surfaceCreds, "sess")).toEqual({ slackUserId: undefined });
  });

  it("leaves a user, agent or global Slack connection unscoped", async () => {
    const userCreds = { ...surfaceCreds, source: "user" as const, connectionId: "conn-1", isUserOwned: true };
    expect(await slackSurfaceRequester(userCreds, "sess")).toBeNull();
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});
