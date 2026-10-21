/**
 * Inbound ingress for webhook-transport channels. Not used by WhatsApp over
 * Baileys (a socket the plugin owns) but part of the contract so a Cloud-API
 * or Telegram-webhook plugin is a drop-in: the plugin verifies the request
 * with the account's stored secret and normalises the payload; the core runs
 * the shared inbound pipeline. Acks fast; work happens after the response.
 */
import { Router, type Request, type Response } from "express";
import { errMsg } from "../../../lib/errors.js";
import { CHALLENGE_RE } from "../const.js";
import { createLogger } from "../../../logger.js";
import { handleInbound } from "../inbound.js";
import { getAccount, authStateFor, toChannelAccount } from "../store.js";
import { channelOf } from "./context.js";

const log = createLogger("channel-webhook");
export const webhookRouter = Router({ mergeParams: true });

/**
 * Provider endpoint verification (Meta: GET with hub.mode/hub.verify_token/
 * hub.challenge). The plugin decides whether the token matches the one the
 * admin stored; the challenge is then echoed back as plain text, which is what
 * the provider expects.
 */
webhookRouter.get("/webhook/:accountId", async (req: Request, res: Response) => {
  const plugin = channelOf(req);
  if (!plugin || plugin.transport !== "webhook" || !plugin.verifyChallenge) {
    res.status(404).json({ success: false, error: "Not found" });
    return;
  }
  const accountId = typeof req.params["accountId"] === "string" ? req.params["accountId"] : "";
  const row = accountId ? await getAccount(accountId) : null;
  if (!row || row.surface.key !== plugin.key || row.status !== "ACTIVE") {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  const token = typeof req.query["hub.verify_token"] === "string" ? req.query["hub.verify_token"] : "";
  const challenge = typeof req.query["hub.challenge"] === "string" ? req.query["hub.challenge"] : "";
  if (!CHALLENGE_RE.test(challenge)) {
    log.warn(`[channel-webhook] challenge rejected account=${accountId}: malformed`);
    res.status(400).json({ success: false, error: "Bad request" });
    return;
  }
  const account = toChannelAccount(row);
  // The token is the credential being checked, not a decision the caller gets
  // to make: verifyChallenge compares it to the secret the admin stored, in
  // constant time, and an absent secret or an empty token both fail there.
  const ok = await plugin.verifyChallenge(account, authStateFor(account.id), token).catch(() => false);
  if (!ok) {
    log.warn(`[channel-webhook] challenge rejected account=${accountId}`);
    res.status(403).json({ success: false, error: "Verification failed" });
    return;
  }
  log.info(`[channel-webhook] challenge verified account=${accountId}`);
  // nosniff so the response cannot be re-interpreted as anything but text.
  res.type("text/plain").set("X-Content-Type-Options", "nosniff").send(challenge);
});

webhookRouter.post("/webhook/:accountId", async (req: Request, res: Response) => {
  const plugin = channelOf(req);
  if (!plugin || plugin.transport !== "webhook" || !plugin.verifySignature || !plugin.parseInbound) {
    res.status(404).json({ success: false, error: "Not found" });
    return;
  }
  const accountId = typeof req.params["accountId"] === "string" ? req.params["accountId"] : "";
  const row = accountId ? await getAccount(accountId) : null;
  if (!row || row.surface.key !== plugin.key || row.status !== "ACTIVE") {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  const account = toChannelAccount(row);
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  let verified = false;
  try {
    verified = await plugin.verifySignature(rawBody, req.headers, account, authStateFor(account.id));
  } catch {
    verified = false;
  }
  if (!verified) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  let messages;
  try {
    messages = plugin.parseInbound(req.body, account, authStateFor(account.id));
  } catch (err) {
    log.warn(`[channel-webhook] parse failed account=${account.id}: ${errMsg(err)}`);
    res.sendStatus(200);
    return;
  }
  res.sendStatus(200);
  for (const msg of messages) {
    void handleInbound({ account, plugin }, msg).catch((err) =>
      log.error(`[channel-webhook] inbound failed account=${account.id}: ${errMsg(err)}`),
    );
  }
});
