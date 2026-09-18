import { Router, type RequestHandler } from 'express';
import type { SecretsVault } from './vault.js';
import { SecretVersionStatus } from './types.js';
import type { SecretDefinitionRow, SecretVersionRow, VaultPrismaClient } from './types.js';

export interface SecretsVaultRouterDeps {
  vault: SecretsVault;
  prisma: VaultPrismaClient & {
    secretDefinition: VaultPrismaClient['secretDefinition'] & {
      findMany(args: { orderBy: { createdAt: 'desc' } }): Promise<SecretDefinitionRow[]>;
    };
    secretVersion: VaultPrismaClient['secretVersion'] & {
      findFirst(args: {
        where: { secretId: string; status: SecretVersionStatus };
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
  getCreatedBy: (req: Parameters<RequestHandler>[0]) => string;
}

/**
 * Express router for the secrets-vault admin UI: list definitions (metadata only,
 * never the value) and create a new secret. Callers inject their own Prisma
 * client, auth guards, and a way to resolve "who is making this request" —
 * this package has no opinion on auth or which ORM instance to use.
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
          const liveVersion = await deps.prisma.secretVersion.findFirst({
            where: { secretId: def.id, status: SecretVersionStatus.LIVE },
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
            createdAt: def.createdAt,
            liveVersion,
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

  return router;
}
