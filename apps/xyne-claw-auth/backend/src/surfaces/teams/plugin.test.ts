/**
 * The plugin against a fake Bot Connector: what it persists on the way in and
 * what it POSTs on the way out. Ids and secrets are invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const fetchMock = vi.fn();
vi.mock("undici", () => ({ fetch: fetchMock }));

const verifyInbound = vi.fn();
const dropToken = vi.fn();
vi.mock("./auth.js", () => ({
  botFrameworkAuth: { verifyInbound, connectorToken: async () => "fake-bearer", dropToken },
}));

const { teamsPlugin, TEAMS_NOT_LINKED_TEXT } = await import("./plugin.js");
const { clearConversationRefCache } = await import("./conversations.js");
type AuthStateStore = import("../messaging/plugin.js").AuthStateStore;

const TENANT = "11111111-2222-3333-4444-555555555555";
const APP_ID = "00000000-0000-0000-0000-0000000000a1";
const BOT = `28:${APP_ID}`;
const SERVICE_URL = "https://smba.example.test/amer/";
const PERSONAL = "a:fake-personal-conversation";
const THREAD = "19:fake-channel@thread.tacv2;messageid=1700000000042";

function memoryAuthState(): AuthStateStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const k = (c: string, id = "") => `${c}|${id}`;
  return {
    rows,
    get: async (c, id) => rows.get(k(c, id)) ?? null,
    getMany: async () => new Map(),
    set: async (c, id, v) => void rows.set(k(c, id), v),
    setMany: async () => undefined,
    delete: async (c, id) => void rows.delete(k(c, id)),
    clear: async () => rows.clear(),
  };
}

const account = (channel: Record<string, unknown> = {}) =>
  ({
    id: "acc-teams",
    orgId: "org-1",
    channel: "teams",
    surfaceId: "teams",
    accountKey: "acct_fake",
    config: {},
    channelConfig: channel,
  }) as never;

const activity = (over: Record<string, unknown> = {}) => ({
  type: "message",
  id: "1700000000001",
  serviceUrl: SERVICE_URL,
  channelId: "msteams",
  from: { id: "29:fake-user", aadObjectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
  recipient: { id: BOT },
  conversation: { id: PERSONAL, conversationType: "personal", tenantId: TENANT },
  text: "hi",
  ...over,
});

const ok = (body: unknown = { id: "sent-1" }) => ({ ok: true, status: 200, json: async () => body });

let authState: ReturnType<typeof memoryAuthState>;
let handle: Awaited<ReturnType<NonNullable<typeof teamsPlugin.openHandle>>>;

beforeEach(async () => {
  vi.clearAllMocks();
  clearConversationRefCache();
  authState = memoryAuthState();
  await authState.set("app-id", "", APP_ID);
  await authState.set("app-password", "", "fake-secret");
  handle = await teamsPlugin.openHandle!(account(), authState);
  fetchMock.mockResolvedValue(ok());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("teamsPlugin inbound", () => {
  it("says it is not linked in Teams terms, never 'add your number'", () => {
    expect(teamsPlugin.unlinkedText).toBe(TEAMS_NOT_LINKED_TEXT);
    expect(teamsPlugin.senderIdFromPhone).toBeUndefined();
  });

  it("checks the bearer against this account's App ID and the activity's serviceUrl", async () => {
    verifyInbound.mockResolvedValue({ ok: true, claims: {} });
    const raw = Buffer.from(JSON.stringify(activity()));
    expect(await teamsPlugin.verifySignature!(raw, { authorization: "Bearer x" }, account(), authState)).toBe(true);
    expect(verifyInbound).toHaveBeenCalledWith({ authorization: "Bearer x", appId: APP_ID, channelId: "msteams", serviceUrl: SERVICE_URL });

    verifyInbound.mockResolvedValue({ ok: false, reason: "bad" });
    expect(await teamsPlugin.verifySignature!(raw, { authorization: "Bearer x" }, account(), authState)).toBe(false);
  });

  it("refuses a body it cannot parse, and an account with no App ID, without verifying", async () => {
    expect(await teamsPlugin.verifySignature!(Buffer.from("{"), {}, account(), authState)).toBe(false);
    const empty = memoryAuthState();
    expect(await teamsPlugin.verifySignature!(Buffer.from(JSON.stringify(activity())), {}, account(), empty)).toBe(false);
    expect(verifyInbound).not.toHaveBeenCalled();
  });

  it("stores where to reply before handing the message to the core", async () => {
    const messages = await teamsPlugin.parseInbound!(activity(), account(), authState);
    expect(messages).toHaveLength(1);
    expect(JSON.parse(authState.rows.get(`conversation-ref|${PERSONAL}`) ?? "{}")).toEqual({
      serviceUrl: SERVICE_URL,
      tenantId: TENANT,
      conversationType: "personal",
      botId: BOT,
    });
  });

  it("drops messages from a tenant outside the account's allowlist", async () => {
    const other = { allowedTenantIds: ["99999999-2222-3333-4444-555555555555"] };
    expect(await teamsPlugin.parseInbound!(activity(), account(other), authState)).toEqual([]);
    expect(authState.rows.has(`conversation-ref|${PERSONAL}`)).toBe(false);
    expect(await teamsPlugin.parseInbound!(activity(), account({ allowedTenantIds: [TENANT] }), authState)).toHaveLength(1);
  });
});

describe("teamsPlugin outbound", () => {
  it("posts markdown into the conversation it heard from, with the bot's token", async () => {
    await teamsPlugin.parseInbound!(activity(), account(), authState);
    const ref = await teamsPlugin.sendText(handle, PERSONAL, "**done**");
    expect(ref).toEqual({ chatId: PERSONAL, messageId: "sent-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://smba.example.test/amer/v3/conversations/${encodeURIComponent(PERSONAL)}/activities`);
    expect(init.headers.authorization).toBe("Bearer fake-bearer");
    expect(JSON.parse(init.body)).toEqual({ type: "message", text: "**done**", textFormat: "markdown" });
  });

  it("replies into the channel thread, to the message that asked", async () => {
    await teamsPlugin.parseInbound!(
      activity({ id: "1700000000050", replyToId: "1700000000042", conversation: { id: THREAD, conversationType: "channel", tenantId: TENANT } }),
      account(),
      authState,
    );
    await teamsPlugin.sendText(handle, THREAD, "on it", { quoted: { chatId: THREAD, messageId: "1700000000050" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://smba.example.test/amer/v3/conversations/${encodeURIComponent(THREAD)}/activities/1700000000050`);
    expect(JSON.parse(init.body)).toMatchObject({ replyToId: "1700000000050" });
  });

  it("refuses to send into a conversation it never heard from", async () => {
    await expect(teamsPlugin.sendText(handle, "a:never-seen", "hi")).rejects.toThrow(/hasn't messaged the bot/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a refused token and retries once", async () => {
    await teamsPlugin.parseInbound!(activity(), account(), authState);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }).mockResolvedValueOnce(ok());
    await teamsPlugin.sendText(handle, PERSONAL, "hi");
    expect(dropToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a Bot Connector rejection", async () => {
    await teamsPlugin.parseInbound!(activity(), account(), authState);
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { code: "BotNotInConversationRoster", message: "not in roster" } }) });
    await expect(teamsPlugin.sendText(handle, PERSONAL, "hi")).rejects.toThrow(/not in roster/);
  });

  it("keeps typing alive in a 1:1 until told to stop", async () => {
    vi.useFakeTimers();
    await teamsPlugin.parseInbound!(activity(), account(), authState);
    await teamsPlugin.setTyping!(handle, PERSONAL, true);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ type: "typing" });
    await vi.advanceTimersByTimeAsync(3_100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await teamsPlugin.setTyping!(handle, PERSONAL, false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends no typing indicator in a channel, where Teams does not show one", async () => {
    await teamsPlugin.parseInbound!(
      activity({ conversation: { id: THREAD, conversationType: "channel", tenantId: TENANT } }),
      account(),
      authState,
    );
    await teamsPlugin.setTyping!(handle, THREAD, true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
