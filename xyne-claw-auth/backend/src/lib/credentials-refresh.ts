/**
 * Generic credential-refresh dispatcher.
 *
 * Called by mcp.ts before listing tools or calling a tool so that OAuth-based
 * connections (DocuSign, Calendly, JotForm) never hand an expired access token
 * to the remote MCP server.
 *
 * Each provider has a different refresh pattern:
 *   DocuSign  — Confidential auth: Authorization: Basic base64(clientId:secret)
 *   Calendly  — Public/DCR client: client_id sent in POST body (no secret)
 *   JotForm   — Public/DCR client: client_id sent in POST body (no secret)
 *   Miro      — Confidential DCR client: client_id + client_secret in POST body
 *   Webflow   — Public/DCR client: client_id sent in POST body (no secret)
 *
 * Returns the (potentially refreshed) credentials that should be used for the
 * MCP call. Also persists the new tokens back to DB so subsequent calls are
 * also covered.
 *
 * If refresh fails we return the original credentials — the downstream call
 * will fail with 401, which is surfaced to the caller as a normal error.
 */

import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import {
  DOCUSIGN_TOKEN_URL,
  docuSignBasicAuthHeader,
  getDocuSignClientCredentials,
} from "./docusign-config.js";
import { evictSession } from "../mcp/runner.js";

import { createLogger } from "../logger.js";
const log = createLogger("credentials-refresh");

const REFRESH_BUFFER_MS = 60_000;

// ── Egnyte ───────────────────────────────────────────────────────────────────────────────

async function refreshEgnyte(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientId = process.env["EGNYTE_CLIENT_ID"];
  const clientSecret = process.env["EGNYTE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    log.error("[credentials-refresh] Egnyte refresh aborted: missing EGNYTE_CLIENT_ID/SECRET");
    return creds;
  }

  const refreshToken = creds["refreshToken"];
  const domain = creds["domain"];
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    log.error("[credentials-refresh] Egnyte refresh aborted: no stored refresh_token");
    return creds;
  }
  if (typeof domain !== "string" || domain.length === 0) {
    log.error("[credentials-refresh] Egnyte refresh aborted: no stored domain");
    return creds;
  }

  const res = await fetch(`https://${domain}.egnyte.com/puboauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    log.error(`[credentials-refresh] Egnyte refresh failed: ${res.status} ${await res.text()}`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };

  await persistCreds(connectionId, updated);
  await evictSession(userId, "egnyte").catch(() => {});
  return updated;
} // refresh 60 s before expiry

// ── DocuSign ──────────────────────────────────────────────────────────────

async function refreshDocuSign(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = getDocuSignClientCredentials());
  } catch {
    return creds;
  }

  const refreshToken = creds["refreshToken"];
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    log.error("[credentials-refresh] DocuSign refresh aborted: no stored refresh_token");
    return creds;
  }

  const res = await fetch(DOCUSIGN_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: docuSignBasicAuthHeader(clientId, clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    log.error(`[credentials-refresh] DocuSign refresh failed: ${res.status} ${await res.text()}`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    // DocuSign rotates refresh tokens on Authorization Code Grant, but defend
    // against responses that omit it (errors, alt grant types) so we don't
    // wipe the only credential that lets us recover.
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };

  await persistCreds(connectionId, updated);
  // Evict the cached MCP client so the next call creates a new one with the fresh token.
  await evictSession(userId, "docusign").catch(() => {});
  return updated;
}

// ── Calendly ──────────────────────────────────────────────────────────────

const CALENDLY_TOKEN_URL = "https://calendly.com/oauth/token";

async function refreshCalendly(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientId = creds["clientId"];
  const refreshToken = creds["refreshToken"];
  if (typeof clientId !== "string" || typeof refreshToken !== "string") {
    log.error("[credentials-refresh] Calendly refresh aborted: missing clientId or refresh_token");
    return creds;
  }

  const res = await fetch(CALENDLY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    log.error(`[credentials-refresh] Calendly refresh failed: ${res.status} ${await res.text()}`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };

  await persistCreds(connectionId, updated);
  await evictSession(userId, "calendly").catch(() => {});
  return updated;
}

// ── JotForm ───────────────────────────────────────────────────────────────

const JOTFORM_TOKEN_URL = "https://oauth2.jotform.com/token";

async function refreshJotForm(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientId = creds["clientId"];
  const refreshToken = creds["refreshToken"];
  if (typeof clientId !== "string" || typeof refreshToken !== "string") {
    log.error("[credentials-refresh] JotForm refresh aborted: missing clientId or refresh_token");
    return creds;
  }

  const res = await fetch(JOTFORM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    log.error(`[credentials-refresh] JotForm refresh failed: ${res.status} ${await res.text()}`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };

  await persistCreds(connectionId, updated);
  await evictSession(userId, "jotform").catch(() => {});
  return updated;
}

// ── Webflow ─────────────────────────────────────────────────────────────

const WEBFLOW_TOKEN_URL = "https://mcp.webflow.com/oauth/token";

async function refreshWebflow(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientId = creds["clientId"];
  const refreshToken = creds["refreshToken"];
  if (typeof clientId !== "string" || typeof refreshToken !== "string") {
    log.error("[credentials-refresh] Webflow refresh aborted: missing clientId or refresh_token");
    return creds;
  }

  const res = await fetch(WEBFLOW_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    log.error(`[credentials-refresh] Webflow refresh failed: ${res.status} ${await res.text()}`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };

  await persistCreds(connectionId, updated);
  await evictSession(userId, "webflow").catch(() => {});
  return updated;
}

// ── Wix ─────────────────────────────────────────────────────────────

const WIX_TOKEN_URL = "https://mcp.wix.com/token";

async function refreshWix(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientId = creds["clientId"];
  const refreshToken = creds["refreshToken"];
  if (typeof clientId !== "string" || typeof refreshToken !== "string") {
    log.error("[credentials-refresh] Wix refresh aborted: missing clientId or refresh_token");
    return creds;
  }

  const res = await fetch(WIX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    log.error(`[credentials-refresh] Wix refresh failed: ${res.status} ${await res.text()}`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };

  await persistCreds(connectionId, updated);
  await evictSession(userId, "wix").catch(() => {});
  return updated;
}

// ── Miro ─────────────────────────────────────────────────────────────────

const MIRO_TOKEN_URL = "https://mcp.miro.com/token";

async function refreshMiro(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientId = creds["clientId"];
  const clientSecret = creds["clientSecret"];
  const refreshToken = creds["refreshToken"];
  if (typeof clientId !== "string" || typeof clientSecret !== "string" || typeof refreshToken !== "string") {
    log.error("[credentials-refresh] Miro refresh aborted: missing clientId, clientSecret, or refresh_token");
    return creds;
  }

  const res = await fetch(MIRO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    log.error(`[credentials-refresh] Miro refresh failed: ${res.status} ${await res.text()}`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };

  await persistCreds(connectionId, updated);
  await evictSession(userId, "miro").catch(() => {});
  return updated;
}

// ── Attio ─────────────────────────────────────────────────────────────

const ATTIO_TOKEN_URL = "https://app.attio.com/oidc/token";

async function refreshAttio(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientId = creds["clientId"];
  const refreshToken = creds["refreshToken"];
  if (typeof clientId !== "string" || typeof refreshToken !== "string") {
    log.error("[credentials-refresh] Attio refresh aborted: missing clientId or refresh_token");
    return creds;
  }

  const res = await fetch(ATTIO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    log.error(`[credentials-refresh] Attio refresh failed: ${res.status} ${await res.text()}`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };

  await persistCreds(connectionId, updated);
  await evictSession(userId, "attio").catch(() => {});
  return updated;
}

// ── MailerLite ─────────────────────────────────────────────────────────────

const MAILERLITE_TOKEN_URL = "https://mcp.mailerlite.com/token";

async function refreshMailerLite(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientId = creds["clientId"];
  const refreshToken = creds["refreshToken"];
  if (typeof clientId !== "string" || typeof refreshToken !== "string") {
    log.error("[credentials-refresh] MailerLite refresh aborted: missing clientId or refresh_token");
    return creds;
  }

  const res = await fetch(MAILERLITE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    log.error(`[credentials-refresh] MailerLite refresh failed: ${res.status} ${await res.text()}`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };

  await persistCreds(connectionId, updated);
  await evictSession(userId, "mailerlite").catch(() => {});
  return updated;
}

// ── Honeycomb ─────────────────────────────────────────────────────────────

const HONEYCOMB_TOKEN_URL = "https://ui.honeycomb.io/oauth/token";

async function refreshHoneycomb(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientId = creds["clientId"];
  const refreshToken = creds["refreshToken"];
  if (typeof clientId !== "string" || typeof refreshToken !== "string") {
    log.error("[credentials-refresh] Honeycomb refresh aborted: missing clientId or refresh_token");
    return creds;
  }

  const res = await fetch(HONEYCOMB_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error(`[credentials-refresh] Honeycomb refresh failed (${res.status}): ${body} — user must reconnect Honeycomb`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };

  log.info(`[credentials-refresh] Honeycomb token refreshed for conn ${connectionId}`);
  await persistCreds(connectionId, updated);
  await evictSession(userId, "honeycomb").catch(() => {});
  return updated;
}

// ── Customer.io ────────────────────────────────────────────────────────────

const CUSTOMERIO_TOKEN_URL = "https://mcp.customer.io/oauth2/token";

async function refreshCustomerio(
  connectionId: string,
  userId: string,
  creds: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientId = creds["clientId"];
  const refreshToken = creds["refreshToken"];
  if (typeof clientId !== "string" || typeof refreshToken !== "string") {
    log.error("[credentials-refresh] Customer.io refresh aborted: missing clientId or refresh_token");
    return creds;
  }

  const res = await fetch(CUSTOMERIO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error(`[credentials-refresh] Customer.io refresh failed (${res.status}): ${body} — user must reconnect Customer.io`);
    return creds;
  }

  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const updated: Record<string, unknown> = {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };

  log.info(`[credentials-refresh] Customer.io token refreshed for conn ${connectionId}`);
  await persistCreds(connectionId, updated);
  await evictSession(userId, "customerio").catch(() => {});
  return updated;
}

// ── Shared helper ─────────────────────────────────────────────────────────

async function persistCreds(connectionId: string, creds: Record<string, unknown>): Promise<void> {
  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
  await prisma.userMcpConnection.update({
    where: { id: connectionId },
    data: { encryptedCreds: ciphertext, iv, authTag },
  });
}

// ── Public entry point ────────────────────────────────────────────────────

const OAUTH_TYPES = new Set(["docusign", "calendly", "jotform", "egnyte", "miro", "webflow", "wix", "attio", "honeycomb", "customerio"]);

/**
 * Returns fresh credentials for an MCP connection, refreshing the access token
 * if it is expired (or within REFRESH_BUFFER_MS of expiry).
 *
 * For non-OAuth types (API key, etc.) the credentials are returned as-is.
 */
export async function getFreshCredentials(
  connectionId: string,
  userId: string,
  serverType: string,
  encryptedCreds: string,
  iv: string,
  authTag: string,
): Promise<Record<string, unknown>> {
  const decrypted = decrypt(encryptedCreds, iv, authTag, CONFIG.encryptionKey);
  const creds = JSON.parse(decrypted) as Record<string, unknown>;

  // Only refresh for OAuth-based types that have an `expires` timestamp.
  if (!OAUTH_TYPES.has(serverType) || typeof creds["expires"] !== "number") {
    return creds;
  }

  const expiresAt = creds["expires"] as number;
  if (Date.now() <= expiresAt - REFRESH_BUFFER_MS) {
    return creds; // still valid
  }

  log.info(`[credentials-refresh] Token expired or near-expiry for ${serverType} (conn ${connectionId}), refreshing…`);

  switch (serverType) {
    case "docusign":   return refreshDocuSign(connectionId, userId, creds);
    case "calendly":   return refreshCalendly(connectionId, userId, creds);
    case "jotform":    return refreshJotForm(connectionId, userId, creds);
    case "egnyte":     return refreshEgnyte(connectionId, userId, creds);
    case "miro":       return refreshMiro(connectionId, userId, creds);
    case "webflow":    return refreshWebflow(connectionId, userId, creds);
    case "wix":        return refreshWix(connectionId, userId, creds);
    case "attio":      return refreshAttio(connectionId, userId, creds);
    case "mailerlite": return refreshMailerLite(connectionId, userId, creds);
    case "honeycomb":   return refreshHoneycomb(connectionId, userId, creds);
    case "customerio":  return refreshCustomerio(connectionId, userId, creds);
    default:           return creds;
  }
}
