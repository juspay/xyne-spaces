import type { BotServices } from './types/bot.js';
import {logger} from '@/utils/logger';

/**
 * Service provider interface for dependency injection
 */
export interface ServiceProvider {
  readonly name: string;
  readonly version?: string;
  getInstance(): unknown;
  isHealthy(): Promise<boolean>;
  cleanup?(): Promise<void>;
}

/**
 * Database service interface
 */
export interface DatabaseService extends ServiceProvider {
  readonly name: 'database';
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ affectedRows: number }>;
  transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
}

/**
 * Logger service interface
 */
export interface LoggerService extends ServiceProvider {
  readonly name: 'logger';
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error, meta?: Record<string, unknown>): void;
}

/**
 * Cache service interface
 */
export interface CacheService extends ServiceProvider {
  readonly name: 'cache';
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Notification service interface
 */
export interface NotificationService extends ServiceProvider {
  readonly name: 'notifications';
  sendEmail(to: string, subject: string, body: string, options?: Record<string, unknown>): Promise<void>;
  sendSMS(to: string, message: string, options?: Record<string, unknown>): Promise<void>;
  sendPush(userId: string, title: string, body: string, options?: Record<string, unknown>): Promise<void>;
}

/**
 * File storage service interface
 */
export interface FileStorageService extends ServiceProvider {
  readonly name: 'fileStorage';
  upload(path: string, content: Buffer | string, options?: Record<string, unknown>): Promise<string>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  getUrl(path: string, expiresIn?: number): Promise<string>;
}

/**
 * External API service interface
 */
export interface ExternalApiService extends ServiceProvider {
  readonly name: string; // e.g., 'openai', 'stripe', 'slack'
  request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    endpoint: string,
    data?: unknown,
    options?: Record<string, unknown>
  ): Promise<T>;
}

/**
 * Service registry for managing service providers
 */
export class ServiceRegistry {
  private readonly services = new Map<string, ServiceProvider>();
  private readonly healthCheckInterval = 60000; // 1 minute
  private healthCheckTimer?: NodeJS.Timeout;

  /**
   * Register a service provider
   */
  public registerService(service: ServiceProvider): void {
    if (this.services.has(service.name)) {
      logger.warn(`[ServiceRegistry] Service '${service.name}' is already registered, replacing...`);
    }

    this.services.set(service.name, service);
    logger.debug(`[ServiceRegistry] Service registered: ${service.name}`, {
      version: service.version
    });

    // Start health checks if this is the first service
    if (this.services.size === 1) {
      this.startHealthChecks();
    }
  }

  /**
   * Unregister a service provider
   */
  public async unregisterService(name: string): Promise<boolean> {
    const service = this.services.get(name);
    if (!service) {
      return false;
    }

    // Cleanup service if supported
    if (service.cleanup) {
      try {
        await service.cleanup();
      } catch (error) {
        logger.error(`[ServiceRegistry] Failed to cleanup service '${name}'`, error);
      }
    }

    this.services.delete(name);
    logger.debug(`[ServiceRegistry] Service unregistered: ${name}`);

    // Stop health checks if no services remain
    if (this.services.size === 0) {
      this.stopHealthChecks();
    }

    return true;
  }

  /**
   * Get a service by name
   */
  public getService<T extends ServiceProvider = ServiceProvider>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  /**
   * Get all registered services
   */
  public getAllServices(): ServiceProvider[] {
    return Array.from(this.services.values());
  }

  /**
   * Check if a service is registered
   */
  public hasService(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Create bot services object for execution context
   */
  public createBotServices(): BotServices {
    const botServices: Record<string, unknown> = {};

    // Add standard services
    const database = this.getService<DatabaseService>('database');
    if (database) {
      botServices.database = database.getInstance();
    }

    const logger = this.getService<LoggerService>('logger');
    if (logger) {
      botServices.logger = logger.getInstance();
    }

    const cache = this.getService<CacheService>('cache');
    if (cache) {
      botServices.cache = cache.getInstance();
    }

    const notifications = this.getService<NotificationService>('notifications');
    if (notifications) {
      botServices.notifications = notifications.getInstance();
    }

    const fileStorage = this.getService<FileStorageService>('fileStorage');
    if (fileStorage) {
      botServices.fileStorage = fileStorage.getInstance();
    }

    // Add external APIs
    const externalApis: Record<string, unknown> = {};
    for (const service of this.services.values()) {
      if (service.name !== 'database' && 
          service.name !== 'logger' && 
          service.name !== 'cache' && 
          service.name !== 'notifications' && 
          service.name !== 'fileStorage') {
        externalApis[service.name] = service.getInstance();
      }
    }

    if (Object.keys(externalApis).length > 0) {
      botServices.externalApis = externalApis;
    }

    return botServices as BotServices;
  }

  /**
   * Perform health check on all services
   */
  public async performHealthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    const healthChecks = Array.from(this.services.entries()).map(async ([name, service]) => {
      try {
        const isHealthy = await service.isHealthy();
        results[name] = isHealthy;
        
        if (!isHealthy) {
          logger.warn(`[ServiceRegistry] Service health check failed: ${name}`);
        }
      } catch (error) {
        logger.error(`[ServiceRegistry] Health check error for service '${name}'`, error);
        results[name] = false;
      }
    });

    await Promise.all(healthChecks);
    return results;
  }

  /**
   * Get service registry statistics
   */
  public getStats(): {
    totalServices: number;
    serviceNames: string[];
    serviceVersions: Record<string, string | undefined>;
  } {
    const serviceNames = Array.from(this.services.keys());
    const serviceVersions: Record<string, string | undefined> = {};
    
    for (const [name, service] of this.services.entries()) {
      serviceVersions[name] = service.version;
    }

    return {
      totalServices: this.services.size,
      serviceNames,
      serviceVersions
    };
  }

  /**
   * Clear all services
   */
  public async clear(): Promise<void> {
    const cleanupPromises = Array.from(this.services.values()).map(async (service) => {
      if (service.cleanup) {
        try {
          await service.cleanup();
        } catch (error) {
          logger.error(`[ServiceRegistry] Failed to cleanup service '${service.name}'`, error);
        }
      }
    });

    await Promise.all(cleanupPromises);
    this.services.clear();
    this.stopHealthChecks();
    
    logger.debug('[ServiceRegistry] All services cleared');
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        const results = await this.performHealthCheck();
        const unhealthyServices = Object.entries(results)
          .filter(([, isHealthy]) => !isHealthy)
          .map(([name]) => name);

        if (unhealthyServices.length > 0) {
          logger.warn(`[ServiceRegistry] Unhealthy services detected`, {
            unhealthyServices,
            totalServices: this.services.size
          });
        }
      } catch (error) {
        logger.error('[ServiceRegistry] Health check failed', error);
      }
    }, this.healthCheckInterval);

    logger.debug('[ServiceRegistry] Health checks started');
  }

  /**
   * Stop periodic health checks
   */
  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
      logger.debug('[ServiceRegistry] Health checks stopped');
    }
  }
}

/**
 * Global service registry instance
 */
export const serviceRegistry = new ServiceRegistry();