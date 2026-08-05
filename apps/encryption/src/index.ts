import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'http';
import crypto from 'crypto';
import { encryptedFieldsConfig } from '@xyne/shared';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getRawPrismaClient } from '@/database/prisma';
import { workspaceServerKeyResolver } from '@/encryption/dek-resolver';
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
import { extractAuthDataFromJWT } from '@/zero/auth';
import { requestLogger } from '@/middleware/request-logger';

const prisma = getRawPrismaClient();
const WORKSPACE_BACKFILL_BATCH_SIZE = 50;
const WORKSPACE_BACKFILL_BATCH_DELAY_MS = 5_000;

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

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (name) {
      cookies[name.trim()] = rest.join('=').trim();
    }
  });
  return cookies;
}

function extractWorkspaceToken(cookies: Record<string, string>): string | undefined {
  const workspaceTokenCookie = Object.keys(cookies).find((key) => key.startsWith('xyne_ws_') && key.endsWith('_token'));
  return workspaceTokenCookie ? cookies[workspaceTokenCookie] : cookies.google_access_token;
}

function getRequestAuth(req: Request): { userId: string; workspaceId: string; sessionId: string } | null {
  const cookies = parseCookies(req.header('cookie'));
  const bearer = req.header('authorization');
  const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : extractWorkspaceToken(cookies);
  const auth = extractAuthDataFromJWT(token);
  const sessionId = cookies.user_session_id;

  if (!auth?.sub || !auth.workspaceId || !sessionId) {
    return null;
  }

  return {
    userId: auth.sub,
    workspaceId: auth.workspaceId,
    sessionId,
  };
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
  const workspaceId = requireString(req.body?.workspaceId, 'workspaceId');
  ok(res, { value: await reEncryptForServer(value, workspaceId) });
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
  const items: Array<{ value: string; workspaceId: string }> = req.body.items.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') {
      throw new HttpError(`items[${index}] must be an object`, 400);
    }
    const record = item as Record<string, unknown>;
    return {
      value: requireValueString(record.value, `items[${index}].value`),
      workspaceId: requireString(record.workspaceId, `items[${index}].workspaceId`),
    };
  });
  ok(res, {
    items: await Promise.all(
      items.map(async (item) => ({
        value: await reEncryptForServer(item.value, item.workspaceId),
      })),
    ),
  });
}));

apiApp.post('/internal/encryption/session/register-client-key', asyncRoute(async (req, res) => {
  const { wrappedKey, sessionId, userId, orgId, expiresAt } = req.body as {
    wrappedKey?: string;
    sessionId?: string;
    userId?: string;
    orgId?: string;
    expiresAt?: string;
  };

  if (!wrappedKey || !sessionId || !userId || !orgId || !expiresAt) {
    res.status(400).json({ error: 'Bad request', message: 'Registration context is incomplete' });
    return;
  }

  const sessionExpiry = new Date(expiresAt);
  if (Number.isNaN(sessionExpiry.getTime()) || sessionExpiry <= new Date()) {
    res.status(400).json({ error: 'Bad request', message: 'expiresAt must be a future ISO timestamp' });
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

  await storeSessionKey(sessionId, userId, orgId, aesKey, sessionExpiry);
  ok(res, { ok: true as const, sessionFingerprint: sessionId });
}));

apiApp.post('/internal/encryption/session/delete-client-key', asyncRoute(async (req, res) => {
  try {
    await prisma.userSessionKey.delete({ where: { sessionId: req.body.sessionId } });
  } catch {}
  ok(res, { ok: true });
}));

apiApp.post('/internal/encryption/org/initialize', asyncRoute(async (req, res) => {
  const orgId = requireString(req.body?.orgId, 'orgId');

  const wrappingTarget = await workspaceServerKeyResolver.initializeOrgEncryption(orgId);
  ok(res, { ok: true, keyRef: wrappingTarget.keyRef });
}));

apiApp.post('/internal/encryption/workspace/provision', asyncRoute(async (req, res) => {
  const workspaceId = requireString(req.body?.workspaceId, 'workspaceId');
  const orgId = requireString(req.body?.orgId, 'orgId');

  const activeKey = await workspaceServerKeyResolver.provisionKeyForWorkspace(workspaceId, orgId);
  ok(res, { ok: true, keyId: activeKey.dekId });
}));

apiApp.post('/internal/encryption/workspace/backfill-provision-batch', asyncRoute(async (req, res) => {
  const rawWorkspaces = req.body?.workspaces;
  if (!Array.isArray(rawWorkspaces) || rawWorkspaces.length === 0) {
    throw new HttpError('workspaces must be a non-empty array', 400);
  }
  const workspaces = new Map<string, { workspaceId: string; orgId: string }>();

  rawWorkspaces.forEach((workspace: unknown, index: number) => {
    if (!workspace || typeof workspace !== 'object') {
      throw new HttpError(`workspaces[${index}] must be an object`, 400);
    }

    const record = workspace as Record<string, unknown>;
    const workspaceId = requireString(record.workspaceId, `workspaces[${index}].workspaceId`);
    const orgId = requireString(record.orgId, `workspaces[${index}].orgId`);
    const duplicate = workspaces.get(workspaceId);
    if (duplicate && duplicate.orgId !== orgId) {
      throw new HttpError(`workspace ${workspaceId} has conflicting orgIds`, 400);
    }
    workspaces.set(workspaceId, { workspaceId, orgId });
  });

  const workspaceTargets = [...workspaces.values()];

  const startedAt = Date.now();
  logger.info('workspace encryption backfill batch started', {
    requestedWorkspaceCount: rawWorkspaces.length,
    uniqueWorkspaceCount: workspaceTargets.length,
    batchSize: WORKSPACE_BACKFILL_BATCH_SIZE,
    interBatchDelayMs: WORKSPACE_BACKFILL_BATCH_DELAY_MS,
  });

  const results = [];
  const totalBatches = Math.ceil(workspaceTargets.length / WORKSPACE_BACKFILL_BATCH_SIZE);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const batchStart = batchIndex * WORKSPACE_BACKFILL_BATCH_SIZE;
    const batchEnd = batchStart + WORKSPACE_BACKFILL_BATCH_SIZE;
    const batch = workspaceTargets.slice(batchStart, batchEnd);

    logger.info('workspace encryption backfill batch chunk started', {
      batchNumber: batchIndex + 1,
      totalBatches,
      batchSize: batch.length,
      startPosition: batchStart + 1,
      endPosition: batchStart + batch.length,
      totalWorkspaces: workspaceTargets.length,
    });

    const batchResults = await Promise.all(batch.map(async ({ workspaceId, orgId }, offset) => {
      const position = batchStart + offset + 1;
      logger.info('workspace encryption backfill workspace started', {
        workspaceId,
        batchNumber: batchIndex + 1,
        position,
        total: workspaceTargets.length,
      });
      try {
        const activeKey = await workspaceServerKeyResolver.backfillActiveKeyForWorkspace(workspaceId, orgId);
        logger.info('workspace encryption backfill workspace succeeded', {
          workspaceId,
          orgId: activeKey.orgId,
          keyId: activeKey.dekId,
          batchNumber: batchIndex + 1,
          position,
          total: workspaceTargets.length,
        });
        return { workspaceId, ok: true, keyId: activeKey.dekId };
      } catch (error) {
        logger.error('workspace encryption backfill workspace failed', {
          workspaceId,
          batchNumber: batchIndex + 1,
          position,
          total: workspaceTargets.length,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          workspaceId,
          ok: false,
          message: error instanceof Error ? error.message : 'Failed to provision workspace encryption',
        };
      }
    }));

    results.push(...batchResults);

    logger.info('workspace encryption backfill batch chunk completed', {
      batchNumber: batchIndex + 1,
      totalBatches,
      batchSize: batch.length,
      succeededCount: batchResults.filter((result) => result.ok).length,
      failedCount: batchResults.filter((result) => !result.ok).length,
    });

    if (batchIndex < totalBatches - 1) {
      logger.info('workspace encryption backfill batch chunk sleeping', {
        nextBatchNumber: batchIndex + 2,
        delayMs: WORKSPACE_BACKFILL_BATCH_DELAY_MS,
      });
      await sleep(WORKSPACE_BACKFILL_BATCH_DELAY_MS);
    }
  }

  const succeededCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - succeededCount;
  logger.info('workspace encryption backfill batch completed', {
    workspaceCount: workspaceTargets.length,
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
