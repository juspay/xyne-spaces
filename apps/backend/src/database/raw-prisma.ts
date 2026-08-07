import { PrismaClient } from '@prisma/client';
import { config } from '@/config/env';

let rawPrismaClient: PrismaClient | null = null;

export function getRawPrismaClient(): PrismaClient {
  if (!rawPrismaClient) {
    rawPrismaClient = new PrismaClient({
      errorFormat: 'pretty',
      datasources: {
        db: {
          url: config.database.url,
        },
      },
    });
  }

  return rawPrismaClient;
}
