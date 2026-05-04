/**
 * Execute a signed write action.
 *
 * A "write action" is any tool call flagged with `writeTools` on an MCP adapter
 * or `isWriteTool` on a custom tool. When the agent invokes it, the runtime
 * queues a signed `pendingAction` instead of executing; the user then approves
 * it through one of two surfaces:
 *
 *  1. Spaces webhook flow — buttons posted into a Spaces thread, clicked
 *     context POSTs to /app/callback
 *  2. /chat UI flow — buttons rendered inline in the assistant bubble, clicks
 *     POST to the chat-approve endpoint
 *
 * Both paths end here. The helper verifies the HMAC, looks up the user's
 * credentials, refreshes OAuth tokens if necessary, then runs the tool. The
 * returned text is the tool's actual result, ready to render back to the user.
 */

import { prisma } from "../db.js";
import { decrypt, encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";

export interface SignedWriteAction {
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  signature: string;
}

export interface WriteActionResult {
  ok: boolean;
  content: string;
  error?: string;
}

/**
 * Verify HMAC + execute. Returns the tool's text output (or an error message).
 * Callers should pre-check `callerUserId === action.userId` before calling this,
 * so we don't execute an action on behalf of someone other than its intended
 * approver.
 */
export async function executeWriteAction(action: SignedWriteAction): Promise<WriteActionResult> {
  const { serverType, tool, params, userId, signature } = action;

  // 1. Signature verification — prevents tampered params sneaking through.
  const { verifyActionSignature } = await import("../routes/mcp.js");
  const actionCore = { serverType, tool, params, userId };
  if (!verifyActionSignature(actionCore, signature)) {
    return { ok: false, content: "", error: "Signature verification failed — action may have been tampered with." };
  }

  try {
    // 2a. Google custom tools (gmail, calendar, drive, tasks, contacts)
    if (serverType === "google") {
      const { getAllCustomTools } = await import("xyne-claw-shared");
      const toolDef = getAllCustomTools().find((t) => t.slug === tool);
      if (!toolDef) return { ok: false, content: "", error: `Unknown Google tool: ${tool}` };

      const accessToken = await getFreshGoogleToken(userId);
      if (!accessToken) return { ok: false, content: "", error: "No valid Google credentials." };

      const result = await toolDef.execute(params, { config: { GOOGLE_ACCESS_TOKEN: accessToken } });
      return { ok: true, content: String(result) };
    }

    // 2b. Microsoft custom tools (outlook, calendar, teams, to-do, onedrive)
    if (serverType === "microsoft") {
      const { getAllCustomTools } = await import("xyne-claw-shared");
      const toolDef = getAllCustomTools().find((t) => t.slug === tool);
      if (!toolDef) return { ok: false, content: "", error: `Unknown Microsoft tool: ${tool}` };

      const accessToken = await getFreshMicrosoftToken(userId);
      if (!accessToken) return { ok: false, content: "", error: "No valid Microsoft credentials." };

      const result = await toolDef.execute(params, { config: { MICROSOFT_ACCESS_TOKEN: accessToken } });
      return { ok: true, content: String(result) };
    }

    // 2c. MCP-based adapters (xyne-spaces, bitbucket, ardra-finops, github, ...)
    const { callTool, hasAdapter } = await import("../mcp/runner.js");
    if (!hasAdapter(serverType)) {
      return { ok: false, content: "", error: `No adapter for server type: ${serverType}` };
    }

    const connection = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServer: { type: serverType } },
    });
    if (!connection) {
      return { ok: false, content: "", error: `No ${serverType} connection for this user.` };
    }

    const decrypted = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
    const credentials = JSON.parse(decrypted) as Record<string, unknown>;

    const result = await callTool(userId, serverType, credentials, tool, params);
    return { ok: true, content: result.content };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, content: "", error: msg };
  }
}

// ── OAuth token helpers (with auto-refresh) ────────────────────────────

async function getFreshGoogleToken(userId: string): Promise<string | null> {
  const connection = await prisma.userMcpConnection.findFirst({
    where: { userId, mcpServer: { type: "google" } },
  });
  if (!connection) return null;

  const decrypted = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
  const creds = JSON.parse(decrypted) as { accessToken: string; refreshToken: string; expires: number };
  if (Date.now() < creds.expires - 60_000) return creds.accessToken;

  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return null;

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!refreshRes.ok) return null;
  const tokens = (await refreshRes.json()) as { access_token: string; expires_in: number };

  const updated = { accessToken: tokens.access_token, refreshToken: creds.refreshToken, expires: Date.now() + tokens.expires_in * 1000 };
  const encrypted = encrypt(JSON.stringify(updated), CONFIG.encryptionKey);
  await prisma.userMcpConnection.update({
    where: { id: connection.id },
    data: { encryptedCreds: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag },
  });
  return tokens.access_token;
}

async function getFreshMicrosoftToken(userId: string): Promise<string | null> {
  const connection = await prisma.userMcpConnection.findFirst({
    where: { userId, mcpServer: { type: "microsoft" } },
  });
  if (!connection) return null;

  const decrypted = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
  const creds = JSON.parse(decrypted) as { accessToken: string; refreshToken: string; expires: number };
  if (Date.now() < creds.expires - 60_000) return creds.accessToken;

  const clientId = process.env["MICROSOFT_CLIENT_ID"];
  const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"];
  const tenantId = process.env["MICROSOFT_TENANT_ID"] ?? "common";
  if (!clientId || !clientSecret) return null;

  const refreshRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!refreshRes.ok) return null;
  const tokens = (await refreshRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };

  // Microsoft rotates refresh tokens on each use.
  const updated = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? creds.refreshToken,
    expires: Date.now() + tokens.expires_in * 1000,
  };
  const encrypted = encrypt(JSON.stringify(updated), CONFIG.encryptionKey);
  await prisma.userMcpConnection.update({
    where: { id: connection.id },
    data: { encryptedCreds: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag },
  });
  return tokens.access_token;
}
