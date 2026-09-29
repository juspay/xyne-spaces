import { Router, type RequestHandler } from 'express';
import { RotationInProgressError, ActiveVersionMismatchError, type SecretsVault } from './vault.js';
import { SecretVersionStatus } from './types.js';
import type { SecretDefinitionRow, SecretVersionRow, VaultPrismaClient } from './types.js';
import type { SecretHandler } from './secretHandler.js';

type VersionSummary = Pick<
  SecretVersionRow,
  'version' | 'status' | 'encryptionImpl' | 'createdAt' | 'verifiedAt' | 'retiredAt'
>;

export interface SecretsVaultRouterDeps {
  vault: SecretsVault;
  prisma: VaultPrismaClient & {
    secretDefinition: VaultPrismaClient['secretDefinition'] & {
      findMany(args: { orderBy: { createdAt: 'desc' } }): Promise<SecretDefinitionRow[]>;
    };
    secretVersion: VaultPrismaClient['secretVersion'] & {
      findFirst(args: {
        where: { secretDefinitionId: string; status: SecretVersionStatus };
        select: {
          version: true;
          status: true;
          encryptionImpl: true;
          createdAt: true;
          verifiedAt: true;
        };
      }): Promise<Pick<
        SecretVersionRow,
        'version' | 'status' | 'encryptionImpl' | 'createdAt' | 'verifiedAt'
      > | null>;
      findMany(args: {
        where: { secretDefinitionId: string };
        orderBy: { version: 'desc' };
        select: {
          version: true;
          status: true;
          encryptionImpl: true;
          createdAt: true;
          verifiedAt: true;
          retiredAt: true;
        };
      }): Promise<VersionSummary[]>;
    };
  };
  guards: RequestHandler[];
  /** Resolves "who is making this request" — used as createdBy on create, updatedBy on rotate/rollback. */
  getCreatedBy: (req: Parameters<RequestHandler>[0]) => string;
  /** Looks up the registered handler for a secret name, or undefined if none is registered. */
  getSecretHandler: (name: string) => SecretHandler | undefined;
}

/**
 * Express router for the secrets-vault admin UI: list definitions (metadata only,
 * never the value), create a new secret, list a secret's version history, rotate
 * to a new value, and roll back to an older one. Callers inject their own Prisma
 * client, auth guards, secretConfig lookup, and a way to resolve "who is making
 * this request" — this package has no opinion on auth, which ORM instance to
 * use, or which secrets exist.
 */
export function createSecretsVaultRouter(deps: SecretsVaultRouterDeps): Router {
  const router = Router();
  router.use(...deps.guards);

  router.get('/', async (_req, res) => {
    try {
      const definitions = await deps.prisma.secretDefinition.findMany({
        orderBy: { createdAt: 'desc' },
      });

      const secrets = await Promise.all(
        definitions.map(async (def) => {
          const activeVersion = await deps.prisma.secretVersion.findFirst({
            where: { secretDefinitionId: def.id, status: SecretVersionStatus.ACTIVE },
            select: {
              version: true,
              status: true,
              encryptionImpl: true,
              createdAt: true,
              verifiedAt: true,
            },
          });
          return {
            id: def.id,
            name: def.name,
            rotationState: def.rotationState,
            createdBy: def.createdBy,
            updatedBy: def.updatedBy,
            createdAt: def.createdAt,
            activeVersion,
          };
        }),
      );

      res.json({ secrets });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list secrets' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { name, value } = req.body ?? {};

      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Bad Request', message: '"name" is required' });
        return;
      }
      if (typeof value !== 'string' || !value.trim()) {
        res.status(400).json({ error: 'Bad Request', message: '"value" is required' });
        return;
      }

      if (!deps.getSecretHandler(name)) {
        res.status(400).json({
          error: 'Bad Request',
          message: `"${name}" is not registered in secretConfig — add a handler before creating it`,
        });
        return;
      }

      const existing = await deps.prisma.secretDefinition.findUnique({ where: { name } });
      if (existing) {
        res.status(409).json({ error: 'Conflict', message: `Secret "${name}" already exists` });
        return;
      }

      const createdBy = deps.getCreatedBy(req);
      await deps.vault.createSecret({ name, value, createdBy });

      res.status(201).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create secret' });
    }
  });

  router.get('/:name/versions', async (req, res) => {
    try {
      const { name } = req.params;

      const definition = await deps.prisma.secretDefinition.findUnique({ where: { name } });
      if (!definition) {
        res.status(404).json({ error: 'Not Found', message: `Secret "${name}" does not exist` });
        return;
      }

      const versions = await deps.prisma.secretVersion.findMany({
        where: { secretDefinitionId: definition.id },
        orderBy: { version: 'desc' },
        select: {
          version: true,
          status: true,
          encryptionImpl: true,
          createdAt: true,
          verifiedAt: true,
          retiredAt: true,
        },
      });

      res.json({ versions });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list versions' });
    }
  });

  router.post('/:name/rotate', async (req, res) => {
    try {
      const { name } = req.params;
      const { value } = req.body ?? {};

      if (typeof value !== 'string' || !value.trim()) {
        res.status(400).json({ error: 'Bad Request', message: '"value" is required' });
        return;
      }

      const handler = deps.getSecretHandler(name);
      if (!handler) {
        res.status(400).json({
          error: 'Bad Request',
          message: `"${name}" is not registered in secretConfig`,
        });
        return;
      }

      const existing = await deps.prisma.secretDefinition.findUnique({ where: { name } });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: `Secret "${name}" does not exist` });
        return;
      }

      const updatedBy = deps.getCreatedBy(req);
      const result = await deps.vault.addVersion({ name, value, updatedBy, verify: handler.verify });

      if (result.status === SecretVersionStatus.FAILED) {
        res.status(422).json({
          error: 'Verification Failed',
          message: `New value for "${name}" failed verification — the previous version is still active`,
          version: result.version,
          status: result.status,
        });
        return;
      }

      res.status(200).json({ success: true, version: result.version, status: result.status });
    } catch (error) {
      if (error instanceof RotationInProgressError) {
        res.status(409).json({ error: 'Conflict', message: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to rotate secret' });
    }
  });

  router.post('/:name/rollback', async (req, res) => {
    try {
      const { name } = req.params;
      const { version } = req.body ?? {};

      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        res.status(400).json({ error: 'Bad Request', message: '"version" must be a positive integer' });
        return;
      }

      const handler = deps.getSecretHandler(name);
      if (!handler) {
        res.status(400).json({
          error: 'Bad Request',
          message: `"${name}" is not registered in secretConfig`,
        });
        return;
      }

      const existing = await deps.prisma.secretDefinition.findUnique({ where: { name } });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: `Secret "${name}" does not exist` });
        return;
      }

      const updatedBy = deps.getCreatedBy(req);
      const result = await deps.vault.rollbackToVersion({ name, version, updatedBy, verify: handler.verify });

      if (result.status === SecretVersionStatus.FAILED) {
        res.status(422).json({
          error: 'Verification Failed',
          message: `Version ${version}'s value for "${name}" failed verification — it may no longer be valid at the external service. The previously-active version is still active.`,
          version: result.version,
          status: result.status,
        });
        return;
      }

      res.status(200).json({ success: true, version: result.version, status: result.status });
    } catch (error) {
      if (error instanceof RotationInProgressError) {
        res.status(409).json({ error: 'Conflict', message: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to roll back secret' });
    }
  });

  router.post('/:name/revoke', async (req, res) => {
    try {
      const { name } = req.params;
      const { expectedVersion } = req.body ?? {};

      if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        res.status(400).json({
          error: 'Bad Request',
          message: '"expectedVersion" must be a positive integer — confirm which version you intend to revoke',
        });
        return;
      }

      const existing = await deps.prisma.secretDefinition.findUnique({ where: { name } });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: `Secret "${name}" does not exist` });
        return;
      }

      const updatedBy = deps.getCreatedBy(req);
      const result = await deps.vault.revokeActiveVersion({ name, expectedVersion, updatedBy });

      if (!result) {
        res.status(409).json({
          error: 'Conflict',
          message: `Secret "${name}" has no active version to revoke`,
        });
        return;
      }

      res.status(200).json({ success: true, version: result.version, status: result.status });
    } catch (error) {
      if (error instanceof ActiveVersionMismatchError) {
        res.status(409).json({ error: 'Conflict', message: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to revoke secret' });
    }
  });

  return router;
}
