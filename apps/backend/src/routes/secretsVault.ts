import { createSecretsVaultRouter } from '@xyne/secrets-vault';
import { AccessType } from '@xyne/shared';
import { authorize } from '@/middleware/authorize';
import { CommonDatabaseClient } from '@/database/commonClient';
import { secretsVault } from '@/services/secretsVault/vaultInstance';
import { secretConfig } from '@/services/secretsVault/secretConfig';

// SecretDefinition/SecretVersion live in the common DB now — see prisma-common/schema.prisma.
const prisma = CommonDatabaseClient.getInstance();

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
  getSecretHandler: (name) => secretConfig[name],
});

export default router;
