/**
 * "Connect" on a messenger.
 *
 * In Spaces the connector card starts OAuth from the signed-in browser. A
 * phone chat has no session, so the card carries a link instead: an opaque,
 * expiring token parked here that names who asked, for which connector, in
 * which chat. Opening it starts the provider's sign-in for THAT user
 * server-side (the same `authorize` the dashboard's button calls), and the
 * provider sends the browser back to `/done`, which tells the chat and lets
 * the agent carry on with what it was asked.
 *
 * The token is the only credential on these routes, so it is unguessable,
 * scoped to one connector, and gone after 24 hours. It can only ever connect
 * an account TO the user it was minted for — the worst a forwarded link can do
 * is let someone else attach their own account to that user's Claw, which is
 * why it is sent only to that user's own chat.
 */
import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { CONFIG } from "../../config.js";
import { prisma } from "../../db.js";
import { errMsg } from "../../lib/errors.js";
import { createLogger } from "../../logger.js";
import { oauthLimiter } from "../../middleware/rate-limiters.js";
import { redisService } from "../../redis.js";
import { getOAuthProvider } from "../../routes/oauth-token.js";
import { continueInChat } from "./busy.js";
import { REDIS_PREFIX } from "./const.js";
import type { ChannelDeliveryTarget } from "./plugin.js";

const log = createLogger("channel-connect");

const CONNECT_TTL_S = 24 * 60 * 60;

export interface ConnectGrant {
  userId: string;
  serverType: string;
  serverName: string;
  target: ChannelDeliveryTarget;
  agentSlug?: string;
}

function grantKey(token: string): string {
  return `${REDIS_PREFIX}:connect:${token}`;
}

function routeBase(channel: string, token: string): string {
  return `${CONFIG.selfUrl.replace(/\/+$/, "")}/claw/api/v1/surfaces/${channel}/connect/${token}`;
}

/** A link that signs `grant.userId` in to `grant.serverType`. */
export async function mintConnectLink(grant: ConnectGrant): Promise<string> {
  const token = randomBytes(16).toString("base64url");
  await redisService.getConnection().set(grantKey(token), JSON.stringify(grant), "EX", CONNECT_TTL_S);
  return routeBase(grant.target.channel, token);
}

async function readGrant(token: string): Promise<ConnectGrant | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  try {
    const raw = await redisService.getConnection().get(grantKey(token));
    return raw ? (JSON.parse(raw) as ConnectGrant) : null;
  } catch {
    return null;
  }
}

/** Connectors without a provider sign-in (API keys, URLs) are set up on the
 *  connector page: credentials are typed into Claw, never into a chat. */
export function connectorSettingsUrl(): string {
  return `${CONFIG.frontendUrl}v3/mcp`;
}

/** Whether the user now holds a credential for the connector — checked
 *  rather than trusting the provider redirect's query string, which anyone
 *  holding the link could type. */
async function isConnected(userId: string, serverType: string): Promise<boolean> {
  const row = await prisma.userMcpConnection
    .findFirst({ where: { userId, mcpServer: { type: serverType } }, select: { id: true } })
    .catch(() => null);
  return !!row;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** A page a phone browser shows for a second before the person goes back to
 *  the chat. Plain, no script, nothing it could leak. */
function page(res: Response, status: number, title: string, body: string): void {
  res
    .status(status)
    .type("html")
    .set("Cache-Control", "no-store")
    .set("X-Content-Type-Options", "nosniff")
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:18vh auto;padding:0 1.25rem;color:#111}` +
        `h1{font-size:1.3rem;margin:0 0 .5rem}p{color:#555;margin:0}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}p{color:#aaa}}</style></head>` +
        `<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body></html>`,
    );
}

export const connectRouter = Router({ mergeParams: true });

connectRouter.get("/connect/:token", oauthLimiter, async (req: Request, res: Response) => {
  const token = typeof req.params["token"] === "string" ? req.params["token"] : "";
  const grant = await readGrant(token);
  if (!grant || grant.target.channel !== req.params["channel"]) {
    page(res, 410, "This link has expired", "Ask again in the chat and you'll get a fresh one.");
    return;
  }
  const provider = getOAuthProvider(grant.serverType);
  if (!provider?.authorize) {
    res.redirect(302, connectorSettingsUrl());
    return;
  }
  try {
    const authUrl = await provider.authorize(grant.userId, { returnTo: `${routeBase(grant.target.channel, token)}/done` });
    log.info(`[connect] sign-in started type=${grant.serverType} user=${grant.userId}`);
    res.redirect(302, authUrl);
  } catch (err) {
    log.warn(`[connect] authorize failed type=${grant.serverType} user=${grant.userId}: ${errMsg(err)}`);
    page(res, 502, `Couldn't start the ${grant.serverName} sign-in`, "Try the link again in a minute.");
  }
});

connectRouter.get("/connect/:token/done", async (req: Request, res: Response) => {
  const token = typeof req.params["token"] === "string" ? req.params["token"] : "";
  const grant = await readGrant(token);
  if (!grant || grant.target.channel !== req.params["channel"]) {
    page(res, 410, "This link has expired", "If you finished signing in, you're all set. Head back to the chat.");
    return;
  }
  if (!(await isConnected(grant.userId, grant.serverType))) {
    page(res, 200, "Sign-in didn't finish", `Tap the link in the chat to try ${grant.serverName} again.`);
    return;
  }
  // Spend it before anything is sent, so a reload cannot announce twice or
  // start a second run.
  const claimed = await redisService.getConnection().del(grantKey(token)).catch(() => 0);
  page(res, 200, `${grant.serverName} is connected`, "You can head back to the chat — I'll take it from here.");
  if (!claimed) return;
  log.info(`[connect] connected type=${grant.serverType} user=${grant.userId}`);
  // What the person would otherwise have to come back and type.
  try {
    await continueInChat({
      target: grant.target,
      userId: grant.userId,
      ...(grant.agentSlug ? { agentSlug: grant.agentSlug } : {}),
      task: `I've connected ${grant.serverName}. Carry on with what I asked.`,
      idempotencyKey: `connect-${token}`,
    });
  } catch (err) {
    log.warn(`[connect] continuation failed type=${grant.serverType} user=${grant.userId}: ${errMsg(err)}`);
  }
});
