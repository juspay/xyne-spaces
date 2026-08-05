import { getRawPrismaClient } from '@/database/prisma';
import { workspaceServerKeyResolver } from '@/encryption/dek-resolver';
import {
  decodeWrappedSessionKeyPayload,
  encodeWrappedSessionKeyPayload,
} from './field-crypto';

const db = getRawPrismaClient();

export async function storeSessionKey(
  sessionId: string,
  userId: string,
  orgId: string,
  aesKey: Buffer,
  expiresAt: Date,
): Promise<void> {
  const { keyRef, wrappedKey } = await workspaceServerKeyResolver.wrapSessionKeyForOrg(
    orgId,
    aesKey,
    sessionId,
  );
  const payload = encodeWrappedSessionKeyPayload(keyRef, wrappedKey);

  await db.userSessionKey.upsert({
    where: { sessionId },
    create: { sessionId, userId, wrappedKey: payload, expiresAt },
    update: { wrappedKey: payload, expiresAt },
  });
}

export async function getSessionKey(sessionId: string): Promise<Buffer | null> {
  const row = await db.userSessionKey.findUnique({ where: { sessionId } });
  if (!row || row.expiresAt < new Date()) {
    return null;
  }

  try {
    const payload = decodeWrappedSessionKeyPayload(Buffer.from(row.wrappedKey));
    return await workspaceServerKeyResolver.unwrapSessionKeyForOrg(
      payload.keyRef,
      payload.wrappedKey,
      sessionId,
    );
  } catch {
    return null;
  }
}
