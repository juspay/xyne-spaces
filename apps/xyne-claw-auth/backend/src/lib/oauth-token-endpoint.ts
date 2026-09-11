/**
 * Single source of truth for the live OAuth-token read used by xyne-claw.
 *
 * Every per-user OAuth connector (google, microsoft, docusign, egnyte, miro,
 * calendly, jotform, wix, webflow, mailerlite, attio, honeycomb, customerio)
 * exposes `GET /:userId/oauth/<provider>/token`, which returns a fresh access
 * token (refreshing if within 60 s of expiry). Those 13 handlers were
 * byte-for-byte identical except for the refresh HTTP call, so the security-
 * sensitive skeleton — the session-token gate, connection lookup, decrypt,
 * expiry check, re-encrypt + persist — was copy-pasted 13 times.
 *
 * This module holds that skeleton ONCE. Each connector contributes only an
 * `OAuthTokenProvider` descriptor (its `refresh()` and, when it surfaces extra
 * fields like accountId/baseUri/domain, a `responseData()`); `buildOAuthTokenRouter`
 * assembles them behind a single generic route `/:userId/oauth/:provider/token`.
 */

import { Router, type Request, type Response } from "express";
import { errMsg } from "./errors.js";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { requireSessionTokenForUserParam } from "../middleware/require-session-token.js";
import { createLogger } from "../logger.js";
import { agentRunRepository } from "../repositories/index.js";

const log = createLogger("oauth-token");

/** Shape every connector's stored creds satisfy; extra fields ride the index. */
export interface BaseOAuthCreds {
  accessToken: string;
  refreshToken: string;
  expires: number;
  [key: string]: unknown;
}

/**
 * Thrown by a provider's `refresh()` to surface a non-500 upstream failure
 * (e.g. 502 when the provider's token endpoint rejects the refresh). The
 * generic handler maps it to `{ status }` and a `<label> token refresh failed`
 * body; anything else becomes a 500.
 */
export class TokenRefreshError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TokenRefreshError";
  }
}

export interface OAuthTokenProvider {
  /** McpServer.type used to find the user's connection row. */
  serverType: string;
  /** Human label for 404 / error messages, e.g. "Google". */
  label: string;
  /**
   * Refresh the token against the provider and return the FULL new creds to
   * persist (preserving provider-specific fields like clientId / accountId /
   * domain). The caller encrypts + stores the result. Throw
   * `TokenRefreshError(status, msg)` on an upstream refresh failure.
   */
  refresh(creds: BaseOAuthCreds): Promise<BaseOAuthCreds>;
  /**
   * Build the response `data` payload from (fresh or refreshed) creds.
   * Defaults to `{ accessToken }`; override to surface extra fields such as
   * accountId/baseUri (DocuSign) or domain (Egnyte).
   */
  responseData?(creds: BaseOAuthCreds): Record<string, unknown>;
}

const defaultResponseData = (creds: BaseOAuthCreds): Record<string, unknown> => ({
  accessToken: creds.accessToken,
});

/**
 * Resolve a usable set of OAuth creds for `userId`, refreshing + persisting when
 * within 60 s of expiry. Returns the (possibly refreshed) creds, or null when
 * the user has no connection for this provider. Throws `TokenRefreshError` when
 * the upstream refresh itself fails.
 *
 * Shared by both the HTTP token route (below) and the MCP credential-loader
 * (lib/credentials-loader.ts), which injects `accessToken` into the spawned
 * google/microsoft stdio MCP server's env — so the connector path and the
 * legacy `/token` path resolve tokens through the exact same logic.
 */
export async function resolveFreshOAuthCreds(
  provider: OAuthTokenProvider,
  userId: string,
): Promise<BaseOAuthCreds | null> {
  const connection = await prisma.userMcpConnection.findFirst({
    where: { userId, mcpServer: { type: provider.serverType } },
    include: { mcpServer: true },
  });
  if (!connection) return null;

  const decrypted = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
  const creds = JSON.parse(decrypted) as BaseOAuthCreds;

  // Fresh enough (60 s buffer) — use the stored token unchanged.
  if (Date.now() <= creds.expires - 60_000) return creds;

  const newCreds = await provider.refresh(creds);
  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(newCreds), CONFIG.encryptionKey);
  await prisma.userMcpConnection.update({
    where: { id: connection.id },
    data: { encryptedCreds: ciphertext, iv, authTag },
  });
  return newCreds;
}

/**
 * Build the router that serves `GET /:userId/oauth/:provider/token` for every
 * registered provider. Mount once at `${BASE}/users` behind `requireAuth`.
 *
 * Live OAuth token retrieval is the most sensitive per-user read on this
 * service; the S2S key + x-user-id alone must NOT be enough. `requireSessionTokenForUserParam`
 * forces the caller to present the run's HMAC session token whose uid matches
 * `:userId`, so a leaked S2S key can't exfiltrate another user's access token.
 */
export function buildOAuthTokenRouter(providers: OAuthTokenProvider[]): Router {
  const registry = new Map(providers.map((p) => [p.serverType, p]));
  const router = Router();
  router.use("/:userId", pinUserIdParam);

  router.get(
    "/:userId/oauth/:provider/token",
    requireSessionTokenForUserParam,
    async (req: Request<{ userId: string; provider: string }>, res: Response) => {
      const { userId, provider: providerKey } = req.params;
      const provider = registry.get(providerKey);
      if (!provider) {
        res.status(404).json({ success: false, error: `Unknown OAuth provider: ${providerKey}` });
        return;
      }
      const toData = provider.responseData ?? defaultResponseData;

      try {
        let creds: BaseOAuthCreds | null;
        try {
          creds = await resolveFreshOAuthCreds(provider, userId);
        } catch (err) {
          if (err instanceof TokenRefreshError) {
            log.error(`[oauth-token] ${provider.serverType} refresh failed for user ${userId}: ${err.message}`);
            res.status(err.status).json({ success: false, error: `${provider.label} token refresh failed` });
            return;
          }
          throw err;
        }

        if (!creds) {
          res.status(404).json({ success: false, error: `No ${provider.label} connection found for this user` });
          return;
        }

        // Record that this run used a user-scoped credential, so the admin
        // "All Runs" view hides it from OTHER admins. Fire-and-forget — never
        // block the token read on the bookkeeping write.
        const sid = req.session?.sessionId;
        if (sid) {
          agentRunRepository.markUsedUserToken(sid).catch((e) =>
            log.warn(`[oauth-token] markUsedUserToken failed for ${sid}:`, errMsg(e)),
          );
        }

        res.json({ success: true, data: toData(creds) });
      } catch (err) {
        log.error(`[oauth-token] ${providerKey} token error:`, err);
        res.status(500).json({ success: false, error: "Internal server error" });
      }
    },
  );

  return router;
}
