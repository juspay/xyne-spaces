import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { setupUserSessionLogging } from './middleware/userSessionLogging';

export class DatabaseClient {
  private static instance: PrismaClient | null = null;
  private static readReplicaInstance: PrismaClient | null = null;
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
    }
    return DatabaseClient.readReplicaInstance;
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

      (DatabaseClient.instance as any).$on('error', (e: any) => {
        logger.error('Database error:', e);
      });

      (DatabaseClient.instance as any).$on('info', (e: any) => {
        logger.info('Database info:', e.message);
      });

      (DatabaseClient.instance as any).$on('warn', (e: any) => {
        logger.warn('Database warning:', e.message);
      });
    }

    return DatabaseClient.instance;
  }

  static async connect(): Promise<void> {
    if (DatabaseClient.isConnected) {
      return;
    }

    try {
      const client = DatabaseClient.getInstance();
      await client.$connect();
      DatabaseClient.isConnected = true;
      logger.info('Database connected successfully');
    } catch (error) {
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  static async disconnect(): Promise<void> {
    if (DatabaseClient.instance && DatabaseClient.isConnected) {
      try {
        await DatabaseClient.instance.$disconnect();
        DatabaseClient.instance = null;
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