import { Prisma } from '@prisma/client';

export const encryptionExtension = Prisma.defineExtension({
  name: 'prisma-field-encryption',
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        return query(args);
      },
    },
  },
});
