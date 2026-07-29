import crypto from 'node:crypto';
import { WorkflowMappingEntityType } from '@prisma/client';
import { db } from '@/database/client';
import { encrypt, decrypt } from '@/services/encryptionService';

const ENTITY_TYPE = WorkflowMappingEntityType.AUTOMATION_WEBHOOK;

function mapKey(seriesId: string): {
  entityType_entityId: { entityType: WorkflowMappingEntityType; entityId: string };
} {
  return { entityType_entityId: { entityType: ENTITY_TYPE, entityId: seriesId } };
}

export async function webhookSecretExists(seriesId: string): Promise<boolean> {
  return !!(await db.workflowMapping.findUnique({ where: mapKey(seriesId) }));
}

export async function issueWebhookSecret(seriesId: string): Promise<string | null> {
  if (await webhookSecretExists(seriesId)) return null;
  const secret = crypto.randomBytes(18).toString('base64url');
  await db.workflowMapping.create({
    data: { entityType: ENTITY_TYPE, entityId: seriesId, entitySecret: encrypt(secret) },
  });
  return secret;
}

export async function storedSecretMatches(seriesId: string, secret: string): Promise<boolean> {
  const row = await db.workflowMapping.findUnique({ where: mapKey(seriesId) });
  if (!row) return false;
  let stored: string;
  try {
    stored = decrypt(row.entitySecret);
  } catch {
    return false;
  }
  const a = Buffer.from(secret, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
