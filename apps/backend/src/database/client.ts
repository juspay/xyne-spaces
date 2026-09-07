import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { retryForever } from '@/utils/retry';
import { installPrismaRetryMiddleware } from './retryMiddleware';
import { setupUserSessionLogging } from './middleware/userSessionLogging';
import { encryptionExtension } from '@/database/prisma-encryption-extension';
import { setupMessageMetadataSync } from './middleware/messageMetadataSync';
import { withAclExtension } from './tenant/acl-extension';
import { withWorkspaceStamp } from './tenant/stamp';
import { setupTicketActivityChannelSync } from './middleware/ticketActivityChannelSync';
import { ticketCreatedActivityExtension } from './extensions/ticketCreatedActivity';
import { setupUserVespaSync } from './middleware/userVespaSync';
import { setupEnumTextValidation } from './middleware/enumTextValidation';

export class DatabaseClient {
  private static instance: PrismaClient | null = null;
  private static wrappedInstance: PrismaClient | null = null;
  private static readReplicaInstance: PrismaClient | null = null;
  private static wrappedReplicaInstance: PrismaClient | null = null;
  private static isConnected = false;

  static getReadReplicaInstance(): PrismaClient | null {
    if (!DatabaseClient.readReplicaInstance) {
      if (!config.database.readReplicaPoolUrl) {
        logger.warn('Read replica not configured. Set DATABASE_READ_REPLICA_POOL_URL environment variable.');
        return null;
      }
      DatabaseClient.readReplicaInstance = new PrismaClient({
        errorFormat: 'pretty',
        datasources: {
          db: {
            url: config.database.readReplicaPoolUrl,
          },
        },
      });

      installPrismaRetryMiddleware(DatabaseClient.readReplicaInstance, 'prisma.replica');

      // ACL-scope reads and authorize writes per the current tenant context.
      // Stamp workspaceId onto INSERT + nested creates from tenant context.
      DatabaseClient.wrappedReplicaInstance = withWorkspaceStamp(withAclExtension(DatabaseClient.readReplicaInstance));
    }
    return DatabaseClient.wrappedReplicaInstance ?? DatabaseClient.readReplicaInstance;
  }

  static getInstance(): PrismaClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new PrismaClient({
        log: [
          { emit: 'event' as const, level: 'query' as const },
          { emit: 'event' as const, level: 'error' as const },
          { emit: 'event' as const, level: 'info' as const },
          { emit: 'event' as const, level: 'warn' as const },
        ],
        errorFormat: 'pretty',
        datasources: {
          db: {
            url: config.database.url,
          },
        },
      });

      // TEMPORARY: UserSession change logging for debugging - remove after issue resolved
      if (config.logging.logUserSessionChanges) {
        setupUserSessionLogging(DatabaseClient.instance, true);
      }

      setupEnumTextValidation(DatabaseClient.instance);
      setupMessageMetadataSync(DatabaseClient.instance);
      setupTicketActivityChannelSync(DatabaseClient.instance);
      setupUserVespaSync(DatabaseClient.instance);

      // Registered last on purpose — see installPrismaRetryMiddleware.
      installPrismaRetryMiddleware(DatabaseClient.instance);

      (DatabaseClient.instance as any).$on('error', (e: any) => {
        logger.error('Database error:', e);
      });

      (DatabaseClient.instance as any).$on('info', (e: any) => {
        logger.info('Database info:', e.message);
      });

      (DatabaseClient.instance as any).$on('warn', (e: any) => {
        logger.warn('Database warning:', e.message);
      });

      // Apply zero field encryption extension (no-op when encryptedFieldsConfig is empty)
      // ticketCreatedActivity is applied last so it runs first: it injects the nested
      // activity row before encryption sees the payload.
      DatabaseClient.instance = DatabaseClient.instance
        .$extends(encryptionExtension)
        .$extends(ticketCreatedActivityExtension) as unknown as PrismaClient;
      DatabaseClient.wrappedInstance = withWorkspaceStamp(withAclExtension(DatabaseClient.instance));
    }

    return DatabaseClient.wrappedInstance ?? DatabaseClient.instance;
  }

  static async connect(): Promise<void> {
    if (DatabaseClient.isConnected) {
      return;
    }

    const client = DatabaseClient.getInstance();
    await retryForever(() => client.$connect(), 'prisma.connect');

    DatabaseClient.isConnected = true;
    logger.info('Database connected successfully');
  }

  static async disconnect(): Promise<void> {
    if (DatabaseClient.instance && DatabaseClient.isConnected) {
      try {
        await DatabaseClient.instance.$disconnect();
        DatabaseClient.instance = null;
        DatabaseClient.wrappedInstance = null;
        DatabaseClient.isConnected = false;
        logger.info('Database disconnected successfully');
      } catch (error) {
        logger.error('Error disconnecting from database:', error);
        throw error;
      }
    }

    if (DatabaseClient.readReplicaInstance) {
      try {
        await DatabaseClient.readReplicaInstance.$disconnect();
        DatabaseClient.readReplicaInstance = null;
        DatabaseClient.wrappedReplicaInstance = null;
        logger.info('Read replica disconnected successfully');
      } catch (error) {
        logger.error('Error disconnecting from read replica:', error);
        throw error;
      }
    }
  }

  static async healthCheck(): Promise<boolean> {
    try {
      const client = DatabaseClient.getInstance();
      await client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error('Database health check failed:', error);
      return false;
    }
  }

  static isConnectionReady(): boolean {
    return DatabaseClient.isConnected;
  }

  static async transaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    const client = DatabaseClient.getInstance();
    return await client.$transaction(callback);
  }
}

export const db = DatabaseClient.getInstance();
export const readReplicaDb = DatabaseClient.getReadReplicaInstance();
