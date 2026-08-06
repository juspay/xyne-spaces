import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'http';
import crypto from 'crypto';
import { encryptedFieldsConfig } from '@xyne/shared';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getRawPrismaClient } from '@/database/prisma';
import { entityServerKeyResolver } from '@/encryption/dek-resolver';
import {
  containsSessionEncryptedFields,
  decryptClientField,
  decryptServerField,
  encryptForSession,
  reEncryptForServer,
  walkMutationArgs,
} from '@/zero/field-crypto';
import { getSessionKey, storeSessionKey } from '@/zero/session-key-store';
import { setupWsUpgradeHandler, shutdownSyncProxy } from '@/sync/sync-proxy';
import { requestLogger } from '@/middleware/request-logger';

const prisma = getRawPrismaClient();
const ENTITY_BACKFILL_BATCH_SIZE = 50;
const ENTITY_BACKFILL_BATCH_DELAY_MS = 5_000;

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return {
      ...err,
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  return {
    message: 'Non-error rejection',
    value: err,
  };
}

class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(`${field} must be a non-empty string`, 400);
  }
  return value.trim();
}

function requireValueString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new HttpError(`${field} must be a string`, 400);
  }
  return value;
}

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncRoute(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}

function serializeEncryptedFields(): Record<string, { fields: string[]; enforceClientEncryption: boolean }> {
  const result: Record<string, { fields: string[]; enforceClientEncryption: boolean }> = {};
  for (const [table, tableConfig] of Object.entries(encryptedFieldsConfig)) {
    result[table] = {
      fields: [...tableConfig.fields],
      enforceClientEncryption: tableConfig.enforceClientEncryption,
    };
  }
  return result;
}

function getApiTransitEncryptedFieldNames(): Set<string> {
  const fields = new Set<string>();
  for (const tableConfig of Object.values(encryptedFieldsConfig)) {
    if (!tableConfig.enforceClientEncryption) continue;
    for (const field of tableConfig.fields) {
      fields.add(field);
    }
  }
  return fields;
}

function decodeBase64Pem(base64Pem: string): string {
  return Buffer.from(base64Pem, 'base64').toString('utf8');
}

function requireS2S(req: Request, res: Response, next: NextFunction): void {
  if (!config.internal.s2sKey || req.header('x-s2s-key') !== config.internal.s2sKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function ok<T>(res: Response, body: T): void {
  res.json(body);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const apiApp = express();
apiApp.use(requestLogger);
apiApp.use(express.json({ limit: '10mb' }));
apiApp.get('/health', (_req, res) => {
  res.json({ ok: true });
});

apiApp.use('/internal', requireS2S);

apiApp.post('/internal/encryption/server/decrypt', asyncRoute(async (req, res) => {
  const value = requireValueString(req.body?.value, 'value');
  ok(res, { value: await decryptServerField(value) });
}));

apiApp.post('/internal/encryption/server/encrypt', asyncRoute(async (req, res) => {
  const value = requireValueString(req.body?.value, 'value');
  const entityId = requireString(req.body?.entityId, 'entityId');
  const entityType = requireString(req.body?.entityType, 'entityType');
  ok(res, { value: await reEncryptForServer(value, entityId, entityType) });
}));

apiApp.post('/internal/encryption/server/batch-decrypt', asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body?.values)) {
    throw new HttpError('values must be an array', 400);
  }
  const values: string[] = req.body.values.map(
    (value: unknown, index: number) => requireValueString(value, `values[${index}]`),
  );
  ok(res, { values: await Promise.all(values.map((value) => decryptServerField(value))) });
}));

apiApp.post('/internal/encryption/server/batch-encrypt', asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body?.items)) {
    throw new HttpError('items must be an array', 400);
  }
  const items: Array<{ value: string; entityId: string; entityType: string }> = req.body.items.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') {
      throw new HttpError(`items[${index}] must be an object`, 400);
    }
    const record = item as Record<string, unknown>;
    return {
      value: requireValueString(record.value, `items[${index}].value`),
      entityId: requireString(record.entityId, `items[${index}].entityId`),
      entityType: requireString(record.entityType, `items[${index}].entityType`),
    };
  });
  ok(res, {
    items: await Promise.all(
      items.map(async (item) => ({
        value: await reEncryptForServer(item.value, item.entityId, item.entityType),
      })),
    ),
  });
}));

apiApp.post('/internal/encryption/session/register-client-key', asyncRoute(async (req, res) => {
  const { wrappedKey, sessionId, userId, orgId } = req.body as {
    wrappedKey?: string;
    sessionId?: string;
    userId?: string;
    orgId?: string;
  };

  if (!wrappedKey || !sessionId || !userId || !orgId) {
    res.status(400).json({ error: 'Bad request', message: 'Registration context is incomplete' });
    return;
  }

  if (!config.enc.rsaPrivateKey) {
    res.status(503).json({ error: 'Encryption not configured' });
    return;
  }

  const aesKey = crypto.privateDecrypt(
    {
      key: decodeBase64Pem(config.enc.rsaPrivateKey),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(wrappedKey, 'base64'),
  );

  if (aesKey.length !== 32) {
    res.status(400).json({ error: 'Unwrapped key must be 32 bytes (AES-256)' });
    return;
  }

  await storeSessionKey(sessionId, userId, orgId, aesKey);
  ok(res, { ok: true as const, sessionFingerprint: sessionId });
}));

apiApp.post('/internal/encryption/session/delete-client-key', asyncRoute(async (req, res) => {
  const sessionId = requireString(req.body?.sessionId, 'sessionId');
  await prisma.userSessionKey.updateMany({
    where: { sessionId, status: 'ACTIVE' },
    data: { status: 'INACTIVE' },
  });
  ok(res, { ok: true });
}));

apiApp.post('/internal/encryption/org/initialize', asyncRoute(async (req, res) => {
  const orgId = requireString(req.body?.orgId, 'orgId');

  const wrappingTarget = await entityServerKeyResolver.initializeOrgEncryption(orgId);
  ok(res, { ok: true, keyRef: wrappingTarget.keyRef });
}));

apiApp.post('/internal/encryption/entity/provision', asyncRoute(async (req, res) => {
  const entityId = requireString(req.body?.entityId, 'entityId');
  const orgId = requireString(req.body?.orgId, 'orgId');
  const entityType = requireString(req.body?.entityType, 'entityType');

  const activeKey = await entityServerKeyResolver.provisionKeyForEntity(entityId, orgId, entityType);
  ok(res, { ok: true, keyId: activeKey.dekId });
}));

apiApp.post('/internal/encryption/entity/backfill-provision-batch', asyncRoute(async (req, res) => {
  const rawEntities = req.body?.entities;
  if (!Array.isArray(rawEntities) || rawEntities.length === 0) {
    throw new HttpError('entities must be a non-empty array', 400);
  }
  const entities = new Map<string, { entityId: string; orgId: string; entityType: string }>();

  rawEntities.forEach((entity: unknown, index: number) => {
    if (!entity || typeof entity !== 'object') {
      throw new HttpError(`entities[${index}] must be an object`, 400);
    }

    const record = entity as Record<string, unknown>;
    const entityId = requireString(record.entityId, `entities[${index}].entityId`);
    const orgId = requireString(record.orgId, `entities[${index}].orgId`);
    const entityType = requireString(record.entityType, `entities[${index}].entityType`);
    const entityKey = JSON.stringify([entityType, entityId]);
    const duplicate = entities.get(entityKey);
    if (duplicate && duplicate.orgId !== orgId) {
      throw new HttpError(`${entityType} entity ${entityId} has conflicting orgIds`, 400);
    }
    entities.set(entityKey, { entityId, orgId, entityType });
  });

  const entityTargets = [...entities.values()];

  const startedAt = Date.now();
  logger.info('entity encryption backfill batch started', {
    requestedEntityCount: rawEntities.length,
    uniqueEntityCount: entityTargets.length,
    batchSize: ENTITY_BACKFILL_BATCH_SIZE,
    interBatchDelayMs: ENTITY_BACKFILL_BATCH_DELAY_MS,
  });

  const results = [];
  const totalBatches = Math.ceil(entityTargets.length / ENTITY_BACKFILL_BATCH_SIZE);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const batchStart = batchIndex * ENTITY_BACKFILL_BATCH_SIZE;
    const batchEnd = batchStart + ENTITY_BACKFILL_BATCH_SIZE;
    const batch = entityTargets.slice(batchStart, batchEnd);

    logger.info('entity encryption backfill batch chunk started', {
      batchNumber: batchIndex + 1,
      totalBatches,
      batchSize: batch.length,
      startPosition: batchStart + 1,
      endPosition: batchStart + batch.length,
      totalEntities: entityTargets.length,
    });

    const batchResults = await Promise.all(batch.map(async ({ entityId, orgId, entityType }, offset) => {
      const position = batchStart + offset + 1;
      logger.info('entity encryption backfill entity started', {
        entityId,
        batchNumber: batchIndex + 1,
        position,
        total: entityTargets.length,
      });
      try {
        const activeKey = await entityServerKeyResolver.backfillActiveKeyForEntity(entityId, orgId, entityType);
        logger.info('entity encryption backfill entity succeeded', {
          entityId,
          orgId: activeKey.orgId,
          keyId: activeKey.dekId,
          batchNumber: batchIndex + 1,
          position,
          total: entityTargets.length,
        });
        return { entityId, entityType, ok: true, keyId: activeKey.dekId };
      } catch (error) {
        logger.error('entity encryption backfill entity failed', {
          entityId,
          batchNumber: batchIndex + 1,
          position,
          total: entityTargets.length,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          entityId,
          entityType,
          ok: false,
          message: error instanceof Error ? error.message : 'Failed to provision entity encryption',
        };
      }
    }));

    results.push(...batchResults);

    logger.info('entity encryption backfill batch chunk completed', {
      batchNumber: batchIndex + 1,
      totalBatches,
      batchSize: batch.length,
      succeededCount: batchResults.filter((result) => result.ok).length,
      failedCount: batchResults.filter((result) => !result.ok).length,
    });

    if (batchIndex < totalBatches - 1) {
      logger.info('entity encryption backfill batch chunk sleeping', {
        nextBatchNumber: batchIndex + 2,
        delayMs: ENTITY_BACKFILL_BATCH_DELAY_MS,
      });
      await sleep(ENTITY_BACKFILL_BATCH_DELAY_MS);
    }
  }

  const succeededCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - succeededCount;
  logger.info('entity encryption backfill batch completed', {
    entityCount: entityTargets.length,
    succeededCount,
    failedCount,
    durationMs: Date.now() - startedAt,
  });

  ok(res, {
    ok: results.every((result) => result.ok),
    results,
  });
}));

apiApp.post('/internal/encryption/session/decrypt-mutation', asyncRoute(async (req, res) => {
  const body = req.body.body as Record<string, unknown>;
  await walkMutationArgs(body, req.body.sessionId);
  ok(res, { body });
}));

apiApp.post('/internal/encryption/session/decrypt-body', asyncRoute(async (req, res) => {
  const sessionKey = await getSessionKey(req.body.sessionId);
  if (!sessionKey) {
    if (containsSessionEncryptedFields(req.body.body)) {
      throw new HttpError('Encrypted request body requires an active session key', 400);
    }
    ok(res, { body: req.body.body });
    return;
  }

  const clone = structuredClone(req.body.body) as unknown;
  decryptBodyRecursive(clone, sessionKey);
  ok(res, { body: clone });
}));

apiApp.post('/internal/encryption/session/encrypt-body', asyncRoute(async (req, res) => {
  const sessionKey = await getSessionKey(req.body.sessionId);
  if (!sessionKey) {
    ok(res, { body: req.body.body });
    return;
  }

  ok(res, {
    body: encryptBodyRecursive(
      req.body.body,
      sessionKey,
      getApiTransitEncryptedFieldNames(),
    ),
  });
}));

apiApp.get('/internal/encryption/public-key', (_req, res) => {
  if (!config.enc.rsaPublicKey) {
    res.status(503).json({ error: 'Encryption not configured' });
    return;
  }

  ok(res, {
    publicKey: decodeBase64Pem(config.enc.rsaPublicKey),
    encryptedFields: serializeEncryptedFields(),
    clientEncryptionEnabled: config.enc.clientEncryptionEnabled,
    apiClientEncryptionEnabled: config.enc.apiClientEncryptionEnabled,
  });
});

apiApp.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err instanceof HttpError
    ? err.statusCode
    : (err instanceof Error && err.message.startsWith('Failed to decrypt') ? 400 : 500);
  const message = err instanceof Error ? err.message : 'Unknown error';

  logger.error('encryption request failed', {
    method: req.method,
    path: req.path,
    statusCode,
    error: message,
  });

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal server error' : 'Bad request',
    message,
  });
});

const zeroProxyApp = express();
zeroProxyApp.use(requestLogger);
zeroProxyApp.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const apiServer = createServer(apiApp);
const zeroProxyServer = createServer(zeroProxyApp);
setupWsUpgradeHandler(zeroProxyServer);

apiServer.listen(config.apiPort, config.host, () => {
  logger.info('encryption api server listening', {
    host: config.host,
    port: config.apiPort,
  });
});

zeroProxyServer.listen(config.zeroProxyPort, config.host, () => {
  logger.info('encryption zero proxy server listening', {
    host: config.host,
    port: config.zeroProxyPort,
  });
});

const shutdown = async () => {
  shutdownSyncProxy();
  await prisma.$disconnect();
  apiServer.close();
  zeroProxyServer.close();
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
  logger.error('UNHANDLED REJECTION', {
    error: serializeError(reason),
  });
});
process.on('uncaughtException', (error: Error) => {
  logger.error('UNCAUGHT EXCEPTION', {
    error: serializeError(error),
  });
});

function decryptBodyRecursive(value: unknown, sessionKey: Buffer): void {
  if (Array.isArray(value)) {
    value.forEach((item) => decryptBodyRecursive(item, sessionKey));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, nestedValue] of Object.entries(record)) {
    if (typeof nestedValue === 'string' && nestedValue.startsWith('ENC:v1|sess|')) {
      record[key] = decryptClientField(nestedValue, sessionKey);
      continue;
    }
    decryptBodyRecursive(nestedValue, sessionKey);
  }
}

function encryptBodyRecursive(value: unknown, sessionKey: Buffer, encryptedFieldNames: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => encryptBodyRecursive(item, sessionKey, encryptedFieldNames));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const encrypted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (
      encryptedFieldNames.has(key) &&
      typeof nestedValue === 'string' &&
      nestedValue.length > 0 &&
      !nestedValue.startsWith('ENC:')
    ) {
      encrypted[key] = encryptForSession(nestedValue, sessionKey);
      continue;
    }
    encrypted[key] = encryptBodyRecursive(nestedValue, sessionKey, encryptedFieldNames);
  }

  return encrypted;
}
