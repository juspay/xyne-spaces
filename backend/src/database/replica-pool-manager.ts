import { Pool } from 'pg';
import { logger } from '@/utils/logger';

export class ReplicaPoolManager {
  private static instance: ReplicaPoolManager | null = null;
  private pools: Pool[] = [];
  private currentIndex = 0;

  private constructor(replicaUrls: string[], poolMax: number, useSSL: boolean) {
    if (replicaUrls.length === 0) {
      throw new Error('ReplicaPoolManager requires at least one replica URL');
    }
    this.pools = replicaUrls.map((url, index) => {
      logger.info(`Creating pool for replica ${index + 1}: ${this.maskConnectionString(url)}`);
      return new Pool({
        connectionString: url,
        max: poolMax,
        ...(useSSL && { ssl: { rejectUnauthorized: false } }),
      });
    });

    logger.info(`ReplicaPoolManager initialized with ${this.pools.length} replica(s)`);
  }

  static getInstance(replicaUrls: string[], poolMax: number, useSSL: boolean): ReplicaPoolManager {
    if (!ReplicaPoolManager.instance) {
      ReplicaPoolManager.instance = new ReplicaPoolManager(replicaUrls, poolMax, useSSL);
    }
    return ReplicaPoolManager.instance;
  }

  static hasInstance(): boolean {
    return ReplicaPoolManager.instance !== null;
  }

  getNextPool(): Pool {
    const pool = this.pools[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.pools.length;
    return pool;
  }

  getReplicaCount(): number {
    return this.pools.length;
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.pools.map(pool => pool.end()));
    logger.info('All replica pools closed');
  }

  private maskConnectionString(connectionString: string): string {
    try {
      const url = new URL(connectionString);
      if (url.password) {
        url.password = '****';
      }
      return url.toString();
    } catch {
      return 'invalid-url';
    }
  }
}
