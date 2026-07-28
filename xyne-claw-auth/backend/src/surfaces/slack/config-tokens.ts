import type { ConnectedSurface, Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { decryptSurfaceSecret, encryptSurfaceSecret } from "../../lib/surface-resolver.js";
import { slackClientWithoutToken, slackErrorCode } from "./api.js";
import { getSlackSurface } from "./store.js";
import { TERMINAL_SLACK_AUTH_ERRORS } from "./const.js";
import { readSlackConnectionConfig } from "./schema.js";

const log = createLogger("slack-config-token");

interface SlackToolingTokenResponse {
  ok?: boolean;
  error?: string;
  token?: string;
  refresh_token?: string;
  exp?: number;
}

export class SlackConfigTokenError extends Error {
  constructor(
    message: string,
    public readonly slackCode?: string,
  ) {
    super(message);
    this.name = "SlackConfigTokenError";
  }
}

function objectConfig(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function hasUsableSlackConfigToken(connection: Pick<ConnectedSurface, "config">): boolean {
  const config = readSlackConnectionConfig(connection.config);
  return (
    config.configTokenStatus !== "expired" &&
    config.configAccessToken !== undefined &&
    config.configRefreshToken !== undefined
  );
}

export async function rotateSlackRefreshToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}> {
  let payload: SlackToolingTokenResponse;
  try {
    payload = (await slackClientWithoutToken().tooling.tokens.rotate({
      refresh_token: refreshToken,
    })) as SlackToolingTokenResponse;
  } catch (error) {
    const code = slackErrorCode(error);
    if (code === undefined) throw error;
    throw new SlackConfigTokenError(`Slack configuration token rotation failed: ${code}`, code);
  }
  const accessToken = payload.token?.trim() ?? "";
  const nextRefreshToken = payload.refresh_token?.trim() ?? "";
  if (!accessToken.startsWith("xoxe.") || !nextRefreshToken.startsWith("xoxe-")) {
    throw new SlackConfigTokenError("Slack returned an invalid configuration token response");
  }
  return {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresAt: typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null,
  };
}

export function configWithRotatedTokens(
  existing: Prisma.JsonValue | null | undefined,
  tokens: { accessToken: string; refreshToken: string },
): Prisma.InputJsonObject {
  return {
    ...objectConfig(existing),
    configAccessToken: encryptSurfaceSecret(tokens.accessToken),
    configRefreshToken: encryptSurfaceSecret(tokens.refreshToken),
    configTokenRotatedAt: new Date().toISOString(),
    configTokenStatus: "valid",
  } as Prisma.InputJsonObject;
}

/**
 * Rotate one stored single-use refresh token under a Postgres advisory lock.
 * The replacement access/refresh pair is written in one update before the
 * transaction releases the lock, preventing two replicas from consuming the
 * same refresh token concurrently.
 */
export async function rotateStoredSlackConfigToken(connectionId: string): Promise<string> {
  const result = await prisma.$transaction(
    async (tx) => {
      const lockKey = `slack-config-token:${connectionId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const connection = await tx.connectedSurface.findUnique({ where: { id: connectionId } });
      if (!connection || !hasUsableSlackConfigToken(connection)) {
        throw new SlackConfigTokenError("Connect Slack with an app configuration token first");
      }
      // Raw object for the write spread below; parsed view for typed reads.
      // Writers MUST spread the raw config — parsing strips keys this surface
      // does not model (signingSecret, per-team installs).
      const config = objectConfig(connection.config);
      const encryptedRefresh = readSlackConnectionConfig(connection.config).configRefreshToken;
      if (!encryptedRefresh) {
        throw new SlackConfigTokenError("Connect Slack with an app configuration token first");
      }
      let tokens: Awaited<ReturnType<typeof rotateSlackRefreshToken>>;
      try {
        const refreshToken = decryptSurfaceSecret(encryptedRefresh, "Slack configuration refresh token");
        tokens = await rotateSlackRefreshToken(refreshToken);
      } catch (error) {
        if (
          error instanceof SlackConfigTokenError &&
          error.slackCode &&
          TERMINAL_SLACK_AUTH_ERRORS.has(error.slackCode)
        ) {
          await tx.connectedSurface.update({
            where: { id: connectionId },
            data: {
              config: { ...config, configTokenStatus: "expired" } as Prisma.InputJsonObject,
            },
          });
          // Returned, NOT thrown: throwing here would roll the transaction back
          // and lose the "expired" marking above, leaving the system retrying a
          // dead token forever. The caller rethrows once the tx has committed.
          return { error };
        }
        throw error;
      }
      await tx.connectedSurface.update({
        where: { id: connectionId },
        data: { config: configWithRotatedTokens(connection.config, tokens) },
      });
      return { accessToken: tokens.accessToken };
    },
    { timeout: 30_000, maxWait: 5_000 },
  );
  if ("error" in result) throw result.error;
  return result.accessToken;
}

export async function runSlackConfigTokenRotation(): Promise<void> {
  const slack = await getSlackSurface();
  if (!slack) return;
  const connections = await prisma.connectedSurface.findMany({
    where: { surfaceId: slack.id },
  });
  for (const connection of connections) {
    if (!hasUsableSlackConfigToken(connection)) continue;
    try {
      await rotateStoredSlackConfigToken(connection.id);
    } catch (error) {
      log.error("[slack-config-token] Failed to rotate an organization configuration token", {
        connectionId: connection.id,
        orgId: connection.orgId,
        errorType: error instanceof Error ? error.name : "UnknownError",
        ...(error instanceof SlackConfigTokenError && error.slackCode ? { slackCode: error.slackCode } : {}),
      });
    }
  }
}
