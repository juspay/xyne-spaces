import { createSecretsVaultRouter } from '@xyne/secrets-vault';
import { AccessType } from '@xyne/shared';
import { authorize } from '@/middleware/authorize';
import { DatabaseClient } from '@/database/client';
import { secretsVault } from '@/services/secretsVault/vaultInstance';

const prisma = DatabaseClient.getInstance();

const router = createSecretsVaultRouter({
  vault: secretsVault,
  prisma,
  guards: [authorize('SECRETS', AccessType.ADMIN, false)],
  getCreatedBy: (req) => {
    if (!req.user?.id) {
      throw new Error('Cannot create a secret without an authenticated user id');
    }
    return req.user.id;
  },
});

export default router;
