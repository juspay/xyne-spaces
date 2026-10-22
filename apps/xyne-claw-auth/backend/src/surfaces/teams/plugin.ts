/**
 * Microsoft Teams as a messaging-channel plugin, on the Bot Framework.
 *
 * Teams POSTs every activity to the bot's messaging endpoint — this account's
 * webhook URL — so this is a `webhook` transport like WhatsApp Cloud: nothing
 * to keep connected, and the account "runs" only so the outbox has an owner
 * to send through. One account is one Azure Bot registration (App ID + client
 * secret), serving the whole org.
 *
 * What it covers: 1:1 chats, @mentions in group chats and channels, and
 * replies into the channel thread that mentioned it. Everything else — the
 * busy gate, /stop /status /help, approvals, questions (as numbered text),
 * the outbox, dedupe and rate limits — is the shared core's.
 *
 * Who may run an agent is the core's identity lookup (identity.ts), keyed by
 * the tenant-scoped Entra object id the Bot Connector signed (activity.ts).
 * No sender can link themselves here: there is no `senderIdFromPhone`, so the
 * self-service number linking is not offered for this channel, and until
 * Entra sign-in lands (XYNE-66905) every sender gets `unlinkedText`.
 *
 * Extension points left for the follow-up tickets:
 *  - XYNE-66905 identity + tenant→org binding: activity.ts `teamsSenderId`,
 *    schema.ts `allowedTenantIds`, `unlinkedText` below.
 *  - XYNE-66906 Adaptive Cards: `capabilities.interactive` + `sendInteractive`,
 *    and `invoke` activities in activity.ts.
 *  - XYNE-66907 files: `capabilities.media` + `sendMedia`, and
 *    `loadAttachments` in activity.ts.
 *  - XYNE-66908 proactive: conversations.ts (stored conversation references).
 */
import type { IncomingHttpHeaders } from "node:http";
import { fetch as httpFetch } from "undici";
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import type { AuthStateStore, ChannelPlugin } from "../messaging/plugin.js";
import { parseTeamsActivity, type TeamsActivity } from "./activity.js";
import { botFrameworkAuth } from "./auth.js";
import { loadConversationRef, saveConversationRef } from "./conversations.js";
import { formatForTeams } from "./format.js";
import {
  SECRET_APP_ID,
  SECRET_APP_PASSWORD,
  teamsConfigOf,
  teamsConfigSchema,
  type TeamsConfig,
} from "./schema.js";

const log = createLogger("teams");

/** Teams refuses a message over ~28 KB of JSON. Characters are not bytes, so
 *  this leaves room for multi-byte text and the envelope. */
const MAX_TEXT_CHARS = 8_000;
/** The Teams client drops "typing…" after a few seconds unless refreshed. */
const TYPING_REFRESH_MS = 3_000;
/** Bot Framework allows ~60 sends per conversation per 30 s and 1,800 an hour;
 *  a run's typing loop must not eat that budget. After this the indicator
 *  simply stops; the reply still lands. */
const TYPING_MAX_MS = 3 * 60 * 1000;

export interface TeamsHandle {
  accountId: string;
  appId: string;
  appPassword: string;
  /** Token authority for a SingleTenant registration; absent ⇒ multi-tenant. */
  appTenantId?: string;
  authState: AuthStateStore;
}

/** Shown to a sender with no linked Spaces identity. Never trusts anything
 *  they type: linking happens through Entra sign-in (XYNE-66905). */
export const TEAMS_NOT_LINKED_TEXT =
  "Your Microsoft Teams account isn't linked to Xyne yet, so I can't run agents for you. Linking from Teams is coming soon; ask your Xyne admin in the meantime.";

class BotConnectorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BotConnectorError";
  }
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

async function requiredSecret(store: AuthStateStore, key: string, label: string): Promise<string> {
  const value = await store.get(key, "");
  if (!value) throw new Error(`${label} is not configured for this account`);
  return value;
}

function connectorUrl(serviceUrl: string, conversationId: string, replyToId?: string): string {
  const base = `${serviceUrl.replace(/\/+$/, "")}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
  return replyToId ? `${base}/${encodeURIComponent(replyToId)}` : base;
}

/** POST an activity to the Bot Connector. A 401 means the cached token went
 *  stale early (secret rotated); it is dropped and the send tried once more. */
async function postActivity(handle: TeamsHandle, url: string, activity: Record<string, unknown>): Promise<{ id: string }> {
  const credentials = { appId: handle.appId, appPassword: handle.appPassword, tenantId: handle.appTenantId };
  for (let attempt = 0; ; attempt++) {
    const token = await botFrameworkAuth.connectorToken(credentials);
    const response = await httpFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(activity),
    });
    if (response.status === 401 && attempt === 0) {
      botFrameworkAuth.dropToken(credentials);
      continue;
    }
    const payload = (await response.json().catch(() => null)) as { id?: string; error?: { code?: string; message?: string } } | null;
    if (!response.ok) {
      throw new BotConnectorError(`Teams Bot Connector: ${payload?.error?.message ?? payload?.error?.code ?? `HTTP ${response.status}`}`, response.status);
    }
    return { id: payload?.id ?? "" };
  }
}

async function refFor(handle: TeamsHandle, chatId: string) {
  const ref = await loadConversationRef(handle.accountId, handle.authState, chatId);
  // Teams only lets a bot post where it has been spoken to (or installed);
  // a chat we never heard from has no endpoint to post to.
  if (!ref) throw new Error("This Teams conversation hasn't messaged the bot yet, so there's nowhere to reply.");
  return ref;
}

export const teamsPlugin: ChannelPlugin<TeamsHandle, TeamsConfig> = {
  key: "teams",
  displayName: "Microsoft Teams",
  transport: "webhook",
  login: { kind: "token" },
  accountScope: "org",
  unlinkedText: TEAMS_NOT_LINKED_TEXT,
  loginFields: [
    {
      key: SECRET_APP_ID,
      label: "Microsoft App ID",
      type: "text",
      placeholder: "00000000-0000-0000-0000-000000000000",
      hint: "Azure Bot, Configuration, Microsoft App ID.",
    },
    {
      key: SECRET_APP_PASSWORD,
      label: "Client secret",
      type: "password",
      hint: "Azure Bot, Configuration, Manage Password, a new client secret's Value.",
    },
  ],
  capabilities: {
    groups: true,
    // The Bot Connector has no "react to a message" call for bots.
    reactions: false,
    typing: true,
    // Files are XYNE-66907; until then a file arrives as a note to the agent.
    media: false,
    maxTextChars: MAX_TEXT_CHARS,
  },
  channelConfigSchema: teamsConfigSchema,

  async openHandle(account, authState) {
    const config = teamsConfigOf(account.channelConfig);
    return {
      accountId: account.id,
      appId: await requiredSecret(authState, SECRET_APP_ID, "Microsoft App ID"),
      appPassword: await requiredSecret(authState, SECRET_APP_PASSWORD, "Client secret"),
      ...(config.appTenantId ? { appTenantId: config.appTenantId } : {}),
      authState,
    };
  },

  /** Fetching a token proves the App ID and secret work, at start rather than
   *  at the first reply. The bot's id on Teams is "28:<App ID>". */
  async describeHandle(handle) {
    await botFrameworkAuth.connectorToken({ appId: handle.appId, appPassword: handle.appPassword, tenantId: handle.appTenantId });
    return { selfId: `28:${handle.appId}` };
  },

  async verifySignature(rawBody, headers, account, authState) {
    let activity: TeamsActivity;
    try {
      activity = JSON.parse(rawBody.toString("utf8")) as TeamsActivity;
    } catch {
      return false;
    }
    const appId = await authState.get(SECRET_APP_ID, "");
    if (!appId) return false;
    const result = await botFrameworkAuth.verifyInbound({
      authorization: headerValue(headers, "authorization"),
      appId,
      channelId: activity.channelId ?? "",
      serviceUrl: activity.serviceUrl ?? "",
    });
    if (!result.ok) {
      log.warn(`[teams] rejected request account=${account.id}: ${result.reason}`);
      return false;
    }
    return true;
  },

  async parseInbound(payload, account, authState) {
    const msg = parseTeamsActivity(payload);
    if (!msg) return [];
    const { allowedTenantIds } = teamsConfigOf(account.channelConfig);
    if (allowedTenantIds.length > 0 && !allowedTenantIds.includes(msg.tenantId)) {
      log.info(`[teams] message from a tenant this account does not serve account=${account.id} tenant=${msg.tenantId}`);
      return [];
    }
    // Before the core sees the message: its reply (or the "not linked"
    // notice) may be sent from another pod, which reads this row.
    await saveConversationRef(account.id, authState, msg.chatId, msg.conversationRef);
    return [msg];
  },

  async sendText(handle, chatId, text, opts) {
    const ref = await refFor(handle, chatId);
    const { id } = await postActivity(handle, connectorUrl(ref.serviceUrl, chatId, opts?.quoted?.messageId), {
      type: "message",
      text,
      textFormat: "markdown",
      ...(opts?.quoted?.messageId ? { replyToId: opts.quoted.messageId } : {}),
    });
    return { chatId, messageId: id };
  },

  /**
   * Teams has no "stop typing": the indicator fades after a few seconds and
   * the reply clears it. So `on` starts a refresh loop and `off` cancels it.
   * Channels never show the indicator, so nothing is sent there.
   */
  async setTyping(handle, chatId, on) {
    const key = `${handle.accountId}:${chatId}`;
    const existing = typingTimers.get(key);
    if (existing) {
      clearInterval(existing);
      typingTimers.delete(key);
    }
    if (!on) return;
    const ref = await refFor(handle, chatId);
    if (ref.conversationType === "channel") return;

    const url = connectorUrl(ref.serviceUrl, chatId);
    await postActivity(handle, url, { type: "typing" });
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > TYPING_MAX_MS) {
        clearInterval(timer);
        typingTimers.delete(key);
        return;
      }
      void postActivity(handle, url, { type: "typing" }).catch((err) =>
        log.warn(`[teams] typing refresh failed account=${handle.accountId}: ${errMsg(err)}`),
      );
    }, TYPING_REFRESH_MS);
    // Never hold the process open for a typing animation.
    timer.unref?.();
    typingTimers.set(key, timer);
  },

  formatText: formatForTeams,
};

/** One refresh loop per (account, conversation). Module-level because the
 *  webhook transport's handle is a credential bag, not a live client. */
const typingTimers = new Map<string, NodeJS.Timeout>();
