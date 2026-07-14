import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("cli-tokens");

const TOKEN_PREFIX = "xyne_cli_";
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedUpdates = new Map<string, number>();

export interface VerifiedCliToken {
  userId: string;
  orgId: string;
  scopes: string[];
}

export function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generate(): { raw: string; hashed: string; prefix: string } {
  const raw = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    raw,
    hashed: hash(raw),
    prefix: raw.slice(0, 12),
  };
}

function recordLastUsed(tokenHash: string): void {
  const now = Date.now();
  const last = lastUsedUpdates.get(tokenHash) ?? 0;
  if (now - last < LAST_USED_THROTTLE_MS) return;
  lastUsedUpdates.set(tokenHash, now);

  void prisma.surfaceAccessToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { lastUsedAt: new Date(now) },
  }).catch((err) => {
    log.warn("[cli-tokens] lastUsedAt update failed:", err instanceof Error ? err.message : err);
  });
}

export async function verify(raw: string | undefined): Promise<VerifiedCliToken | null> {
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) return null;

  const tokenHash = hash(raw);
  const record = await prisma.surfaceAccessToken.findUnique({
    where: { tokenHash },
    select: {
      userId: true,
      orgId: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { orgId: true } },
    },
  });

  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) return null;
  if (!record.orgId || record.user.orgId !== record.orgId) return null;

  recordLastUsed(tokenHash);
  return {
    userId: record.userId,
    orgId: record.orgId,
    scopes: record.scopes,
  };
}
