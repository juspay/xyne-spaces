import { getRawPrismaClient } from '@/database/prisma';
import { entityServerKeyResolver } from '@/encryption/dek-resolver';
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
): Promise<void> {
  const { keyRef, wrappedKey } = await entityServerKeyResolver.wrapSessionKeyForOrg(
    orgId,
    aesKey,
    sessionId,
  );
  const payload = encodeWrappedSessionKeyPayload(keyRef, wrappedKey);

  await db.userSessionKey.upsert({
    where: { sessionId },
    create: { sessionId, userId, wrappedKey: payload, status: 'ACTIVE' },
    update: { userId, wrappedKey: payload, status: 'ACTIVE' },
  });
}

export async function getSessionKey(sessionId: string): Promise<Buffer | null> {
  const row = await db.userSessionKey.findUnique({ where: { sessionId } });
  if (!row || row.status !== 'ACTIVE') {
    return null;
  }

  try {
    const payload = decodeWrappedSessionKeyPayload(Buffer.from(row.wrappedKey));
    return await entityServerKeyResolver.unwrapSessionKeyForOrg(
      payload.keyRef,
      payload.wrappedKey,
      sessionId,
    );
  } catch {
    return null;
  }
}
