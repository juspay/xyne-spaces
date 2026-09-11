/**
 * RapidAPI LinkedIn (Fresh LinkedIn Profile Data) connector routes.
 *
 * Unlike OAuth providers, this connector uses a static X-RapidAPI-Key supplied
 * directly by the user. There is no redirect flow — the key is sent in the
 * POST body, encrypted, and stored as a UserMcpConnection.
 *
 * Endpoints
 * ─────────
 *   POST /:userId/oauth/rapidapi-linkedin/connect
 *     Accepts { apiKey } in the JSON body, encrypts it, and upserts a
 *     UserMcpConnection of type "rapidapi-linkedin".
 *
 *   GET  /:userId/oauth/rapidapi-linkedin/token
 *     Decrypts the stored API key and returns it as { accessToken }.
 *     Called by xyne-claw when it needs to forward calls to the RapidAPI
 *     LinkedIn MCP server.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { asyncHandler, ok, notFound, unauthorized, badRequest } from "../lib/http.js";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { syncToolsForServer } from "../tool-sync.js";
import { evictSession } from "../mcp/runner.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { requireSessionTokenForUserParam } from "../middleware/require-session-token.js";

import { createLogger } from "../logger.js";
const log = createLogger("rapidapi-linkedin");

const RAPIDAPI_HOST = "fresh-linkedin-profile-data.p.rapidapi.com";
const RAPIDAPI_BASE_URL = `https://${RAPIDAPI_HOST}`;

/** Shape of the credentials stored encrypted in the DB. */
interface RapidApiLinkedInCreds {
  apiKey: string;
}

/** Ensures the "rapidapi-linkedin" McpServer row exists, creating it if needed. */
async function ensureRapidApiLinkedInServer() {
  const existing = await prisma.mcpServer.findUnique({
    where: { type: "rapidapi-linkedin" },
  });
  if (existing) return existing;

  return prisma.mcpServer.create({
    data: {
      type: "rapidapi-linkedin",
      name: "LinkedIn (RapidAPI)",
      url: `${process.env["RAPIDAPI_LINKEDIN_MCP_URL"] ?? "http://localhost:3100"}/mcp`,
      description:
        "Fresh LinkedIn Profile Data via RapidAPI — get profiles, companies, employees, posts and search people.",
      transport: "http",
      healthcheckSpec: { name: "linkedin_get_profile", params: { linkedin_url: "https://www.linkedin.com/in/williamhgates" } },
      connectorMeta: { scope: "global", mode: "self-serve" },
    },
  });
}

/** Encrypt + upsert the API key for a user. */
async function storeApiKey(userId: string, apiKey: string): Promise<void> {
  const creds: RapidApiLinkedInCreds = { apiKey };
  const { ciphertext, iv, authTag } = encrypt(
    JSON.stringify(creds),
    CONFIG.encryptionKey,
  );

  const server = await ensureRapidApiLinkedInServer();

  const existing = await prisma.userMcpConnection.findFirst({
    where: { userId, mcpServerId: server.id },
  });

  if (existing) {
    await prisma.userMcpConnection.update({
      where: { id: existing.id },
      data: { encryptedCreds: ciphertext, iv, authTag },
    });
  } else {
    await prisma.userMcpConnection.create({
      data: { userId, mcpServerId: server.id, encryptedCreds: ciphertext, iv, authTag },
    });
  }

  await evictSession(userId, "rapidapi-linkedin").catch(() => {});

  syncToolsForServer(userId, "rapidapi-linkedin", server.name, { apiKey }).catch(
    (err) => {
      log.error(
        `[rapidapi-linkedin] tool sync failed for user ${userId}:`,
        err,
      );
    },
  );
}

const router = Router();

// CSRF / IDOR guard — userId in path must match the session user.
router.use("/:userId", pinUserIdParam);

// ── GET /:userId/oauth/rapidapi-linkedin/token ─────────────────────────────

/**
 * Returns the stored X-RapidAPI-Key as { accessToken }.
 * Called by xyne-claw to forward requests to the RapidAPI LinkedIn MCP server.
 */
router.get(
  "/:userId/oauth/rapidapi-linkedin/token",
  requireSessionTokenForUserParam,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };

    const connection = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServer: { type: "rapidapi-linkedin" } },
      include: { mcpServer: true },
    });

    if (!connection) {
      throw notFound("No LinkedIn (RapidAPI) connection found for this user.");
    }

    const decrypted = decrypt(
      connection.encryptedCreds,
      connection.iv,
      connection.authTag,
      CONFIG.encryptionKey,
    );
    const creds = JSON.parse(decrypted) as RapidApiLinkedInCreds;

    ok(res, { accessToken: creds.apiKey });
  }),
);

// ── POST /:userId/oauth/rapidapi-linkedin/connect ──────────────────────────

/**
 * Accepts { apiKey } in the JSON body. Validates the key against RapidAPI,
 * then encrypts and stores it.
 */
router.post(
  "/:userId/oauth/rapidapi-linkedin/connect",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { apiKey } = req.body as { apiKey?: string };

    if (!apiKey?.trim()) {
      throw badRequest("apiKey is required in the request body.");
    }

    const trimmedKey = apiKey.trim();

    // Validate the key against RapidAPI before storing.
    const valid = await validateRapidApiKey(trimmedKey);
    if (!valid) {
      throw unauthorized("The provided X-RapidAPI-Key was rejected by RapidAPI (HTTP 403).");
    }

    await storeApiKey(userId, trimmedKey);

    log.info(`[rapidapi-linkedin] Stored API key for user ${userId}`);
    ok(res, { message: "LinkedIn (RapidAPI) connected successfully." });
  }),
);

// ── Validation helper ──────────────────────────────────────────────────────

/**
 * Makes a lightweight call to RapidAPI to confirm the key is accepted.
 * Returns false only on HTTP 403 (invalid key). Any other status (including
 * 429 quota exhausted) is treated as a valid key.
 */
async function validateRapidApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${RAPIDAPI_BASE_URL}/get-linkedin-profile?linkedin_url=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fwilliamhgates`,
      {
        method: "GET",
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
        signal: AbortSignal.timeout(8000),
      },
    );

    return res.status !== 403;
  } catch {
    // Network / timeout — optimistically allow storage.
    return true;
  }
}

export { router as rapidApiLinkedInRouter };
