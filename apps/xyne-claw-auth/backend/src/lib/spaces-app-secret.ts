/**
 * Helper for managing the per-agent `signingSecret` claw-auth uses to verify
 * Spaces' outbound webhook HMAC.
 *
 * The signing secret originates in Spaces' `installed_apps.signingSecret`
 * (encrypted with Spaces' own ENCRYPTION_KEY, which is intentionally NOT
 * the same value as claw-auth's). To populate claw-auth's `agents.signingSecret`
 * without sharing keys, we go through Spaces' app API:
 *
 *   POST {spacesUrl}/api/apps/signing-secret/:appId
 *
 * The endpoint decrypts on the Spaces side and returns plaintext to an
 * authenticated app owner/admin. claw-auth re-encrypts with its own
 * AES-256-GCM and persists.
 *
 * Two population paths, both ending with the same on-disk format:
 *
 * 1. API path (`fetchAndStoreSigningSecretFromSpacesApi`) — inline from
 *    configure-webhook (agents.ts) when a NEW agent is registered. Uses the
 *    configuring admin's session token; Spaces decrypts and returns
 *    plaintext. Subject to Spaces' per-user ACL (admin or app creator).
 *
 * 2. DB path (`backfillSigningSecretFromSpacesDb`) — reads
 *    `installed_apps.signingSecret` straight from the Spaces DB via the
 *    existing SPACES_DB_URL read-only connection (same as user-session
 *    reads), decrypts with SPACES_ENCRYPTION_KEY, re-encrypts with
 *    claw-auth's own key. No per-user ACL — claw-auth's DB access is the
 *    trust boundary. Used by the temporary admin backfill endpoint for OLD
 *    agents created by other users. Delete that route once backfill is done.
 *
 * Wire format on disk (matches spacesAppToken):
 *   `${ciphertext}:${iv}:${authTag}` (each base64)
 */
import { CONFIG } from "../config.js";
import { encrypt, decryptSpacesCbc } from "../crypto.js";
import { prisma } from "../db.js";
import { getInstalledAppSigningSecret } from "./spaces-db.js";

import { createLogger } from "../logger.js";
const log = createLogger("spaces-app-secret");

function packGcm(plaintext: string): string {
  const e = encrypt(plaintext, CONFIG.encryptionKey);
  return `${e.ciphertext}:${e.iv}:${e.authTag}`;
}

/**
 * DB-path backfill — reads the CBC-encrypted signing secret straight from
 * the Spaces DB, decrypts with SPACES_ENCRYPTION_KEY, re-encrypts with
 * claw-auth's GCM key, persists to agents.signingSecret. Bypasses the
 * per-user ACL the API path is subject to.
 *
 * Returns true on success, false on any failure (logged). Requires
 * SPACES_ENCRYPTION_KEY to be set AND SPACES_DB_URL configured with SELECT
 * on installed_apps.
 */
export async function backfillSigningSecretFromSpacesDb(args: {
  agentId: string;
  spacesAppId: string;
}): Promise<boolean> {
  const { agentId, spacesAppId } = args;
  if (CONFIG.spacesEncryptionKey.length === 0) {
    log.warn(
      `[spaces-app-secret] SPACES_ENCRYPTION_KEY unset — cannot decrypt Spaces DB blob for agentId=${agentId}. Set it to xyne-spaces' ENCRYPTION_KEY value.`,
    );
    return false;
  }
  const blob = await getInstalledAppSigningSecret(spacesAppId);
  if (!blob) {
    log.warn(`[spaces-app-secret] no installed_apps row for spacesAppId=${spacesAppId} (agentId=${agentId})`);
    return false;
  }
  try {
    const plaintext = decryptSpacesCbc(blob, CONFIG.spacesEncryptionKey);
    if (!plaintext) {
      log.warn(`[spaces-app-secret] decrypt produced empty secret for agentId=${agentId}`);
      return false;
    }
    await prisma.agent.update({
      where: { id: agentId },
      data: { signingSecret: packGcm(plaintext) },
    });
    log.info(`[spaces-app-secret] stored signing secret for agentId=${agentId} (db path)`);
    return true;
  } catch (err) {
    log.warn(
      `[spaces-app-secret] db-path backfill failed for agentId=${agentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Fetch the signing secret for an agent's Spaces app via API and persist it.
 * Returns true on success, false on any failure (logged). Callers should
 * treat false as a webhook-readiness failure: signature verification is
 * fail-closed, so this agent cannot receive webhooks until a retry succeeds.
 */
export async function fetchAndStoreSigningSecretFromSpacesApi(args: {
  agentId: string;
  spacesAppId: string;
  /** Spaces user token + session cookies — same auth used for configure-webhook. */
  userAuthHeaders: Record<string, string>;
}): Promise<boolean> {
  const { agentId, spacesAppId, userAuthHeaders } = args;
  const url = `${CONFIG.spacesInternalUrl}/api/apps/signing-secret/${encodeURIComponent(spacesAppId)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...userAuthHeaders },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(
        `[spaces-app-secret] fetch failed for agentId=${agentId} status=${res.status}: ${body.slice(0, 200)}`,
      );
      return false;
    }
    // Spaces' getSigningSecret returns the secret FLAT — `{ signingSecret: "..." }`
    // — not wrapped in the usual `{ data: ... }` envelope.
    // See xyne-spaces/backend/src/apps/core/appUtils.ts:216-218.
    const json = (await res.json()) as { signingSecret?: string; data?: { signingSecret?: string } };
    const plaintext = json?.signingSecret ?? json?.data?.signingSecret;
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      log.warn(`[spaces-app-secret] fetch returned no secret for agentId=${agentId}`);
      return false;
    }
    await prisma.agent.update({
      where: { id: agentId },
      data: { signingSecret: packGcm(plaintext) },
    });
    log.info(`[spaces-app-secret] stored signing secret for agentId=${agentId} (api path)`);
    return true;
  } catch (err) {
    log.warn(
      `[spaces-app-secret] api fetch errored for agentId=${agentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
