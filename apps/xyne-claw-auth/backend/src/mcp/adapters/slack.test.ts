import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canSlackRequesterReadChannel, handleSlackFindChannel, slackSurfaceReadBlockReason } from "./slack.js";

// A fake Slack workspace, answered by a mocked fetch. All ids are made up.
const BOT_TOKEN = "xoxb-fake-token";
const REQUESTER = "UREQUESTER";
const OTHER_USER = "UOTHER";
const GUEST = "UGUEST";

interface FakeChannel {
  id: string;
  name: string;
  is_private?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  user?: string;
  members: string[];
}

const CHANNELS: FakeChannel[] = [
  { id: "CPUBLIC", name: "general", members: [OTHER_USER] },
  { id: "GSECRET", name: "secret-plans", is_private: true, members: [OTHER_USER] },
  { id: "GTEAM", name: "team-private", is_private: true, members: [REQUESTER, OTHER_USER] },
  { id: "DREQ", name: "", is_im: true, user: REQUESTER, members: [REQUESTER] },
  { id: "DOTHER", name: "", is_im: true, user: OTHER_USER, members: [OTHER_USER] },
];

const USERS: Record<string, { is_restricted?: boolean }> = {
  [REQUESTER]: {},
  [OTHER_USER]: {},
  [GUEST]: { is_restricted: true },
};

function slackResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function fakeSlack(input: string | URL): Response {
  const url = new URL(String(input));
  const method = url.pathname.replace("/api/", "");
  const q = url.searchParams;
  const channel = CHANNELS.find((c) => c.id === q.get("channel"));
  switch (method) {
    case "conversations.info":
      return slackResponse(channel ? { ok: true, channel } : { ok: false, error: "channel_not_found" });
    case "conversations.members":
      return slackResponse(channel ? { ok: true, members: channel.members } : { ok: false, error: "channel_not_found" });
    case "users.info": {
      const user = USERS[q.get("user") ?? ""];
      return slackResponse(user ? { ok: true, user } : { ok: false, error: "user_not_found" });
    }
    case "users.conversations": {
      const user = q.get("user") ?? "";
      const types = (q.get("types") ?? "").split(",");
      const channels = CHANNELS.filter(
        (c) => c.members.includes(user) && types.includes(c.is_private ? "private_channel" : "public_channel"),
      );
      return slackResponse({ ok: true, channels });
    }
    case "conversations.list":
      return slackResponse({
        ok: true,
        channels: CHANNELS.filter((c) => !c.is_im).map((c) => ({ id: c.id, name: c.name, is_private: !!c.is_private })),
      });
    default:
      return slackResponse({ ok: false, error: "unknown_method" });
  }
}

const fetchMock = vi.fn(async (input: string | URL) => fakeSlack(input));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canSlackRequesterReadChannel", () => {
  it("refuses a private channel the requester is not in", async () => {
    expect(await canSlackRequesterReadChannel(BOT_TOKEN, REQUESTER, "GSECRET")).toBe(false);
  });

  it("allows a private channel the requester is in", async () => {
    expect(await canSlackRequesterReadChannel(BOT_TOKEN, REQUESTER, "GTEAM")).toBe(true);
  });

  it("allows only the requester's own DM with the bot", async () => {
    expect(await canSlackRequesterReadChannel(BOT_TOKEN, REQUESTER, "DREQ")).toBe(true);
    expect(await canSlackRequesterReadChannel(BOT_TOKEN, REQUESTER, "DOTHER")).toBe(false);
  });

  it("allows a public channel for a full member, but not for a guest outside it", async () => {
    expect(await canSlackRequesterReadChannel(BOT_TOKEN, REQUESTER, "CPUBLIC")).toBe(true);
    expect(await canSlackRequesterReadChannel(BOT_TOKEN, GUEST, "CPUBLIC")).toBe(false);
  });

  it("refuses when Slack cannot find the channel", async () => {
    expect(await canSlackRequesterReadChannel(BOT_TOKEN, REQUESTER, "CMISSING")).toBe(false);
  });
});

describe("slackSurfaceReadBlockReason", () => {
  const credentials = { botToken: BOT_TOKEN, teamId: "TFAKE" };

  it("blocks history and thread reads of a private channel the requester is not in", async () => {
    const history = await slackSurfaceReadBlockReason(
      credentials,
      { slackUserId: REQUESTER },
      "slack_get_channel_history",
      { channel_id: "GSECRET" },
    );
    const replies = await slackSurfaceReadBlockReason(
      credentials,
      { slackUserId: REQUESTER },
      "slack_get_thread_replies",
      { channel_id: "GSECRET", thread_ts: "1700000000.000100" },
    );
    expect(history).toMatch(/^Blocked:/);
    expect(replies).toMatch(/^Blocked:/);
  });

  it("lets a read of a channel the requester is in go ahead", async () => {
    const reason = await slackSurfaceReadBlockReason(
      credentials,
      { slackUserId: REQUESTER },
      "slack_get_channel_history",
      { channel_id: "GTEAM" },
    );
    expect(reason).toBeNull();
  });

  it("blocks reads when the run lost the requester's Slack id", async () => {
    const reason = await slackSurfaceReadBlockReason(
      credentials,
      { slackUserId: undefined },
      "slack_get_channel_history",
      { channel_id: "CPUBLIC" },
    );
    expect(reason).toMatch(/^Blocked:/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not check tools that are not channel reads", async () => {
    const reason = await slackSurfaceReadBlockReason(
      credentials,
      { slackUserId: REQUESTER },
      "slack_get_users",
      {},
    );
    expect(reason).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleSlackFindChannel", () => {
  const credentials = { botToken: BOT_TOKEN, teamId: "TFAKE" };

  it("hides private channels the requester is not in on a Slack-surface run", async () => {
    const out = JSON.parse(await handleSlackFindChannel(credentials, {}, { slackUserId: REQUESTER })) as {
      channels: Array<{ id: string }>;
    };
    expect(out.channels.map((c) => c.id).sort()).toEqual(["CPUBLIC", "GTEAM"]);
  });

  it("hides every private channel when the requester is unknown", async () => {
    const out = JSON.parse(await handleSlackFindChannel(credentials, {}, { slackUserId: undefined })) as {
      channels: Array<{ id: string }>;
    };
    expect(out.channels.map((c) => c.id)).toEqual(["CPUBLIC"]);
  });

  it("keeps listing every channel the bot sees when not scoped to a requester", async () => {
    const out = JSON.parse(await handleSlackFindChannel(credentials, {})) as { channels: Array<{ id: string }> };
    expect(out.channels.map((c) => c.id).sort()).toEqual(["CPUBLIC", "GSECRET", "GTEAM"]);
  });
});
