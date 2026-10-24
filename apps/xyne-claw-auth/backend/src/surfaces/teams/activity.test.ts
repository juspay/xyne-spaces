import { describe, expect, it } from "vitest";
import { parseTeamsActivity } from "./activity.js";

// Fake ids throughout: no real tenant, app or user.
const TENANT = "11111111-2222-3333-4444-555555555555";
const BOT = "28:00000000-0000-0000-0000-0000000000b0";
const OID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const base = (over: Record<string, unknown> = {}) => ({
  type: "message",
  id: "1700000000001",
  timestamp: "2026-10-22T10:00:00.000Z",
  serviceUrl: "https://smba.example.test/amer/",
  channelId: "msteams",
  from: { id: "29:fake-user", name: "Asha", aadObjectId: OID.toUpperCase() },
  recipient: { id: BOT, name: "Claw" },
  conversation: { id: "a:fake-personal-conversation", conversationType: "personal", tenantId: TENANT },
  text: "hello there",
  ...over,
});

describe("parseTeamsActivity", () => {
  it("maps a 1:1 message, keyed by the tenant-scoped Entra object id", () => {
    const msg = parseTeamsActivity(base());
    expect(msg).toMatchObject({
      messageId: "1700000000001",
      chatId: "a:fake-personal-conversation",
      senderId: `${TENANT}:${OID}`,
      senderName: "Asha",
      isGroup: false,
      text: "hello there",
      fromSelf: false,
      tenantId: TENANT,
      timestamp: Math.floor(Date.parse("2026-10-22T10:00:00.000Z") / 1000),
      conversationRef: { serviceUrl: "https://smba.example.test/amer/", tenantId: TENANT, conversationType: "personal", botId: BOT },
    });
  });

  it("treats every 1:1 line as addressed to the bot", () => {
    // Otherwise requireMention (on by default) would ignore the whole chat.
    expect(parseTeamsActivity(base())?.mentionedSelf).toBe(true);
  });

  it("strips the bot's own mention in a channel, so a command reaches the core bare", () => {
    const msg = parseTeamsActivity(
      base({
        conversation: { id: "19:fake-channel@thread.tacv2;messageid=1700000000001", conversationType: "channel", tenantId: TENANT },
        text: "<at>Claw</at> /status",
        entities: [{ type: "mention", text: "<at>Claw</at>", mentioned: { id: BOT, name: "Claw" } }],
      }),
    );
    expect(msg).toMatchObject({ text: "/status", mentionedSelf: true, isGroup: true });
  });

  it("keeps other people's mentions as @Name and does not count them as the bot's", () => {
    const msg = parseTeamsActivity(
      base({
        conversation: { id: "19:fake-group@thread.v2", conversationType: "groupChat", tenantId: TENANT },
        text: "ask <at>Ravi</at> about it &amp; report",
        entities: [{ type: "mention", text: "<at>Ravi</at>", mentioned: { id: "29:someone-else", name: "Ravi" } }],
      }),
    );
    expect(msg).toMatchObject({ text: "ask @Ravi about it & report", mentionedSelf: false, isGroup: true });
  });

  it("threads a top-level channel post: the chat id names the post as the thread root", () => {
    const msg = parseTeamsActivity(
      base({
        id: "1700000000042",
        conversation: { id: "19:fake-channel@thread.tacv2", conversationType: "channel", tenantId: TENANT },
      }),
    );
    expect(msg?.chatId).toBe("19:fake-channel@thread.tacv2;messageid=1700000000042");
    expect(msg?.ref).toEqual({ chatId: "19:fake-channel@thread.tacv2;messageid=1700000000042", messageId: "1700000000042" });
  });

  it("keeps a reply's thread id as Teams sent it, so the thread stays one conversation", () => {
    const thread = "19:fake-channel@thread.tacv2;messageid=1700000000042";
    const msg = parseTeamsActivity(
      base({ id: "1700000000099", replyToId: "1700000000042", conversation: { id: thread, conversationType: "channel", tenantId: TENANT } }),
    );
    expect(msg?.chatId).toBe(thread);
  });

  it("marks the bot's own echo and ignores non-message activities and other channels", () => {
    expect(parseTeamsActivity(base({ from: { id: BOT, name: "Claw" } }))?.fromSelf).toBe(true);
    expect(parseTeamsActivity(base({ type: "conversationUpdate" }))).toBeNull();
    expect(parseTeamsActivity(base({ type: "invoke" }))).toBeNull();
    expect(parseTeamsActivity(base({ channelId: "webchat" }))).toBeNull();
  });

  it("refuses an activity with no tenant rather than keying an identity on nothing", () => {
    expect(parseTeamsActivity(base({ conversation: { id: "a:x", conversationType: "personal" } }))).toBeNull();
  });

  it("keys a sender with no Entra id apart from every object id", () => {
    const msg = parseTeamsActivity(base({ from: { id: "29:federated", name: "Guest" } }));
    expect(msg?.senderId).toBe(`${TENANT}:bf:29:federated`);
  });

  it("carries a file-only message so the agent hears about it (files are a later ticket)", async () => {
    const msg = parseTeamsActivity(
      base({ text: "", attachments: [{ contentType: "application/vnd.microsoft.teams.file.download.info", name: "q3.xlsx" }] }),
    );
    expect(msg?.mediaKind).toBe("file");
    await expect(msg?.loadAttachments?.()).resolves.toEqual([]);
  });
});
