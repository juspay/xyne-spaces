import type { ConnectedSurface, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { acquireCronLeaderLock } from "../lib/cron-leader-lock.js";
import { decryptSurfaceSecret, encryptSurfaceSecret } from "../lib/surface-resolver.js";

const log = createLogger("slack-config-token");
const ROTATION_INTERVAL_MS = 4 * 60 * 60 * 1000;
const TERMINAL_SLACK_AUTH_ERRORS = new Set([
  "invalid_refresh_token",
  "token_revoked",
  "token_expired",
  "invalid_auth",
  "account_inactive",
]);

interface SlackToolingTokenResponse {
  ok?: boolean;
  error?: string;
  token?: string;
  refresh_token?: string;
  exp?: number;
}

export class SlackConfigTokenError extends Error {
  constructor(message: string, public readonly slackCode?: string) {
    super(message);
    this.name = "SlackConfigTokenError";
  }
}

function objectConfig(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function hasUsableSlackConfigToken(connection: Pick<ConnectedSurface, "config">): boolean {
  const config = objectConfig(connection.config);
  return config["configTokenStatus"] !== "expired"
    && typeof config["configAccessToken"] === "string"
    && typeof config["configRefreshToken"] === "string";
}

export async function rotateSlackRefreshToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}> {
  const response = await fetch("https://slack.com/api/tooling.tokens.rotate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as SlackToolingTokenResponse | null;
  if (!response.ok || !payload?.ok) {
    throw new SlackConfigTokenError(
      `Slack configuration token rotation failed${payload?.error ? `: ${payload.error}` : ""}`,
      payload?.error,
    );
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
  const result = await prisma.$transaction(async (tx) => {
    const lockKey = `slack-config-token:${connectionId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const connection = await tx.connectedSurface.findUnique({ where: { id: connectionId } });
    if (!connection || !hasUsableSlackConfigToken(connection)) {
      throw new SlackConfigTokenError("Connect Slack with an app configuration token first");
    }
    const config = objectConfig(connection.config);
    const encryptedRefresh = config["configRefreshToken"] as string;
    let tokens: Awaited<ReturnType<typeof rotateSlackRefreshToken>>;
    try {
      const refreshToken = decryptSurfaceSecret(encryptedRefresh, "Slack configuration refresh token");
      tokens = await rotateSlackRefreshToken(refreshToken);
    } catch (error) {
      if (error instanceof SlackConfigTokenError
          && error.slackCode
          && TERMINAL_SLACK_AUTH_ERRORS.has(error.slackCode)) {
        await tx.connectedSurface.update({
          where: { id: connectionId },
          data: {
            config: { ...config, configTokenStatus: "expired" } as Prisma.InputJsonObject,
          },
        });
        return { error };
      }
      throw error;
    }
    await tx.connectedSurface.update({
      where: { id: connectionId },
      data: { config: configWithRotatedTokens(connection.config, tokens) },
    });
    return { accessToken: tokens.accessToken };
  }, { timeout: 30_000, maxWait: 5_000 });
  if ("error" in result) throw result.error;
  return result.accessToken;
}

export async function runSlackConfigTokenRotation(): Promise<void> {
  const slack = await prisma.surface.findUnique({ where: { key: "slack" }, select: { id: true } });
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

function currentFourHourBucket(): string {
  const now = new Date();
  return `${now.toISOString().slice(0, 10)}-${Math.floor(now.getUTCHours() / 4)}`;
}

function scheduleNextRotation(): void {
  const now = Date.now();
  const next = Math.floor(now / ROTATION_INTERVAL_MS) * ROTATION_INTERVAL_MS + ROTATION_INTERVAL_MS;
  setTimeout(async () => {
    try {
      if (await acquireCronLeaderLock(`slack-config-token-${currentFourHourBucket()}`, ROTATION_INTERVAL_MS)) {
        await runSlackConfigTokenRotation();
      }
    } catch (error) {
      log.error("[slack-config-token] Rotation cron failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    } finally {
      scheduleNextRotation();
    }
  }, next - now);
}

export function initSlackConfigTokenCron(): void {
  log.info("[slack-config-token] Initialising four-hour configuration token rotation");
  scheduleNextRotation();
}
