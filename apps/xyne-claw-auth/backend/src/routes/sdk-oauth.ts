/**
 * OAuth endpoints for the public Spaces SDK.
 *
 * claw-auth acts as the authorization server; the Spaces backend is the resource
 * server and never talks to this service at request time — it verifies access
 * tokens offline against the JWKS published here.
 *
 * Grants:
 *  - `token-exchange`: trade a CLI personal access token (obtained through the
 *    existing device flow at /cli/auth/*) for an SDK access + refresh pair. This
 *    reuses the device pairing and consent screen that already exist rather than
 *    standing up a second, near-identical one.
 *  - `refresh_token`: rotate. Single-use, with family revocation on reuse.
 *
 * A dedicated device flow with per-scope consent is a later addition; it changes
 * how the *first* token is obtained without changing anything downstream.
 */

import { Router, type Request, type Response } from "express";
import { ALL_SCOPES, type Scope } from "@xyne/spaces-contract";
import { verify as verifyCliToken } from "../lib/cli-tokens.js";
import { getSpacesSdkPrincipal } from "../lib/spaces-db.js";
import {
  consumeRefreshToken,
  getPublicJwks,
  issueRefreshToken,
  mintAccessToken,
  revokeAllForUser,
  sdkTokensEnabled,
  SDK_TOKEN_AUDIENCE,
  SDK_TOKEN_ISSUER,
} from "../services/sdk-tokens.js";
import { requireAuth } from "../middleware/require-auth.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { createLogger } from "../logger.js";

const log = createLogger("sdk-oauth");
const router = Router();

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";

/** First-party clients. A registration API is only needed for third parties. */
const KNOWN_CLIENTS = new Set(["xyne-spaces-sdk", "xyne-cli"]);

function requireEnabled(req: Request, res: Response, next: () => void): void {
  if (!sdkTokensEnabled()) {
    res.status(404).json({
      error: "not_supported",
      error_description: "The SDK OAuth surface is not enabled on this deployment.",
    });
    return;
  }
  next();
}

router.use(requireEnabled);

/**
 * Public keys for the resource server. Cacheable — jose refetches automatically
 * when it sees an unknown `kid`, which is what makes key rotation a non-event.
 */
router.get("/jwks.json", async (_req: Request, res: Response) => {
  try {
    const jwks = await getPublicJwks();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(jwks);
  } catch (err) {
    log.error("[sdk-oauth] failed to export JWKS:", err);
    res.status(500).json({ error: "server_error" });
  }
});

/** Discovery document, so clients can find the endpoints without hardcoding. */
router.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
  const base = `${req.protocol}://${req.get("host")}${req.baseUrl}`;
  res.json({
    issuer: SDK_TOKEN_ISSUER,
    token_endpoint: `${base}/token`,
    jwks_uri: `${base}/jwks.json`,
    grant_types_supported: [TOKEN_EXCHANGE_GRANT, "refresh_token"],
    scopes_supported: ALL_SCOPES,
    audience: SDK_TOKEN_AUDIENCE,
  });
});

router.post("/token", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const grantType = typeof body["grant_type"] === "string" ? body["grant_type"] : "";
  const clientId = typeof body["client_id"] === "string" ? body["client_id"] : "";

  if (!KNOWN_CLIENTS.has(clientId)) {
    res.status(400).json({ error: "invalid_client" });
    return;
  }

  try {
    if (grantType === TOKEN_EXCHANGE_GRANT) {
      await handleTokenExchange(req, res, clientId, body);
      return;
    }
    if (grantType === "refresh_token") {
      await handleRefresh(res, clientId, body);
      return;
    }
    res.status(400).json({ error: "unsupported_grant_type" });
  } catch (err) {
    log.error("[sdk-oauth] token request failed:", err);
    res.status(500).json({ error: "server_error" });
  }
});

async function handleTokenExchange(
  req: Request,
  res: Response,
  clientId: string,
  body: Record<string, unknown>,
): Promise<void> {
  // The subject token may arrive in the body (RFC 8693) or as the Authorization
  // header, which is what a CLI already holds.
  const header = req.header("Authorization");
  const subjectToken =
    (typeof body["subject_token"] === "string" ? body["subject_token"] : undefined) ??
    (header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined);

  const verified = await verifyCliToken(subjectToken);
  if (!verified) {
    res.status(401).json({ error: "invalid_grant", error_description: "Subject token is not valid." });
    return;
  }

  const requested = parseScopes(body["scope"]);
  const granted = requested.length > 0 ? requested : [...ALL_SCOPES];

  const principal = await getSpacesSdkPrincipal(verified.userId, "sdk-oauth");
  if (!principal) {
    // The claw identity is valid but has no complete Spaces principal, so the
    // resource server would reject anything we mint. Fail here with a reason.
    res.status(400).json({
      error: "invalid_grant",
      error_description:
        "No Spaces workspace membership resolved for this user; open Spaces once, then retry.",
    });
    return;
  }

  const access = await mintAccessToken(
    {
      userId: principal.id,
      email: principal.email,
      name: principal.name,
      workspaceId: principal.workspaceId,
      memberId: principal.memberId,
      orgId: verified.orgId,
    },
    granted,
    clientId,
  );
  const refresh = await issueRefreshToken({
    userId: principal.id,
    orgId: verified.orgId,
    clientId,
    scopes: granted,
  });

  log.info(`[sdk-oauth] issued tokens userId=${principal.id} client=${clientId} scopes=${granted.length}`);
  res.json({
    access_token: access.accessToken,
    token_type: "Bearer",
    expires_in: access.expiresIn,
    refresh_token: refresh.refreshToken,
    scope: granted.join(" "),
  });
}

async function handleRefresh(
  res: Response,
  clientId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const raw = typeof body["refresh_token"] === "string" ? body["refresh_token"] : "";
  if (!raw) {
    res.status(400).json({ error: "invalid_request", error_description: "refresh_token is required." });
    return;
  }

  const consumed = await consumeRefreshToken(raw);
  if (!consumed.ok) {
    res.status(400).json({
      error: "invalid_grant",
      error_description:
        consumed.reason === "reused"
          ? "This refresh token was already used. All sessions in its family have been revoked; sign in again."
          : `Refresh token is ${consumed.reason}.`,
    });
    return;
  }

  if (consumed.clientId !== clientId) {
    res.status(400).json({ error: "invalid_client" });
    return;
  }

  const principal = await getSpacesSdkPrincipal(consumed.userId, "sdk-oauth-refresh");
  if (!principal) {
    res.status(400).json({ error: "invalid_grant", error_description: "Principal is no longer resolvable." });
    return;
  }

  const access = await mintAccessToken(
    {
      userId: principal.id,
      email: principal.email,
      name: principal.name,
      workspaceId: principal.workspaceId,
      memberId: principal.memberId,
      orgId: consumed.orgId,
    },
    consumed.scopes,
    clientId,
  );
  // Rotation: the consumed token stays in the same family so a later replay of
  // any generation is still detectable.
  const refresh = await issueRefreshToken({
    userId: consumed.userId,
    orgId: consumed.orgId,
    clientId,
    scopes: consumed.scopes,
    familyId: consumed.familyId,
  });

  res.json({
    access_token: access.accessToken,
    token_type: "Bearer",
    expires_in: access.expiresIn,
    refresh_token: refresh.refreshToken,
    scope: consumed.scopes.join(" "),
  });
}

/** Revoke every SDK session for the calling user. */
router.post("/revoke", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const count = await revokeAllForUser(userId);
    res.json({ success: true, revoked: count });
  } catch (err) {
    log.error("[sdk-oauth] revoke failed:", err);
    res.status(500).json({ error: "server_error" });
  }
});

function parseScopes(raw: unknown): Scope[] {
  const list =
    typeof raw === "string" ? raw.split(" ") : Array.isArray(raw) ? raw.map(String) : [];
  const valid = new Set<string>(ALL_SCOPES);
  return list.filter((s): s is Scope => valid.has(s));
}

export { router as sdkOAuthRouter };
