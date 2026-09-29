import { Router, type RequestHandler } from 'express';
import type { SecretsVault } from './vault.js';
import { SecretVersionStatus } from './types.js';
import type { SecretDefinitionRow, SecretVersionRow, VaultPrismaClient } from './types.js';
import type { SecretHandler } from './secretHandler.js';

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
    };
  };
  guards: RequestHandler[];
  /** Resolves "who is making this request" — used as createdBy on create, updatedBy on rotate. */
  getCreatedBy: (req: Parameters<RequestHandler>[0]) => string;
  /** Looks up the registered handler for a secret name, or undefined if none is registered. */
  getSecretHandler: (name: string) => SecretHandler | undefined;
}

/**
 * Express router for the secrets-vault admin UI: list definitions (metadata only,
 * never the value), create a new secret, and rotate an existing one. Callers
 * inject their own Prisma client, auth guards, secretConfig lookup, and a way
 * to resolve "who is making this request" — this package has no opinion on
 * auth, which ORM instance to use, or which secrets exist.
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
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to rotate secret' });
    }
  });

  return router;
}
