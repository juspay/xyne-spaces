import { PrismaClient as CommonPrismaClient } from '../../prisma-common/generated/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

/**
 * Builds the common DB connection URL with pool settings from env config.
 * Pool size defaults to 2 — this DB only serves lightweight counter lookups.
 * Explicit connection_limit/pool_timeout params in COMMON_DATABASE_URL win.
 */
function buildCommonDatabaseUrl(): string {
  const configuredUrl = config.commonDatabase.url.trim();
  if (!configuredUrl) {
    throw new Error('COMMON_DATABASE_URL is not configured');
  }

  const url = new URL(configuredUrl);
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', String(config.commonDatabase.poolSize));
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', String(config.commonDatabase.poolTimeoutSeconds));
  }
  return url.toString();
}

export class CommonDatabaseClient {
  private static instance: CommonPrismaClient | null = null;
  private static isConnected = false;

  static isConfigured(): boolean {
    return config.commonDatabase.url.trim().length > 0;
  }

  static getInstance(): CommonPrismaClient {
    if (!CommonDatabaseClient.isConfigured()) {
      throw new Error('Common database is not configured');
    }

    if (!CommonDatabaseClient.instance) {
      CommonDatabaseClient.instance = new CommonPrismaClient({
        log: [
          { emit: 'event' as const, level: 'error' as const },
          { emit: 'event' as const, level: 'warn' as const },
        ],
        errorFormat: 'pretty',
        datasources: {
          db: {
            url: buildCommonDatabaseUrl(),
          },
        },
      });

      (CommonDatabaseClient.instance as any).$on('error', (e: any) => {
        logger.error('Common database error:', e);
      });

      (CommonDatabaseClient.instance as any).$on('warn', (e: any) => {
        logger.warn('Common database warning:', e.message);
      });
    }

    return CommonDatabaseClient.instance;
  }

  static async connect(): Promise<boolean> {
    if (CommonDatabaseClient.isConnected) {
      return true;
    }

    if (!CommonDatabaseClient.isConfigured()) {
      logger.warn(
        'COMMON_DATABASE_URL is not configured; continuing without the optional common database'
      );
      return false;
    }

    try {
      const client = CommonDatabaseClient.getInstance();
      await client.$connect();
      CommonDatabaseClient.isConnected = true;
      logger.info('Common database connected successfully');
      return true;
    } catch (error) {
      CommonDatabaseClient.isConnected = false;
      logger.error(
        'Failed to connect to the optional common database; application startup will continue:',
        error
      );
      return false;
    }
  }

  static async getConnectedInstance(): Promise<CommonPrismaClient> {
    if (!(await CommonDatabaseClient.connect())) {
      throw new Error('Common database is not configured or unavailable');
    }

    return CommonDatabaseClient.getInstance();
  }

  static async disconnect(): Promise<void> {
    if (CommonDatabaseClient.instance && CommonDatabaseClient.isConnected) {
      try {
        await CommonDatabaseClient.instance.$disconnect();
        CommonDatabaseClient.instance = null;
        CommonDatabaseClient.isConnected = false;
        logger.info('Common database disconnected successfully');
      } catch (error) {
        logger.error('Error disconnecting from common database:', error);
        throw error;
      }
    }
  }

  static async healthCheck(): Promise<boolean> {
    if (!CommonDatabaseClient.isConfigured() || !CommonDatabaseClient.isConnected) {
      return false;
    }

    try {
      const client = CommonDatabaseClient.getInstance();
      await client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error('Common database health check failed:', error);
      return false;
    }
  }

  static isConnectionReady(): boolean {
    return CommonDatabaseClient.isConnected;
  }
}
