import { SudoQuery } from 'sudo-query';
import { logger } from '@/utils/logger';

interface SudoQueryUser {
  id: string;
  name?: string;
  email?: string;
}

type JSONSerializable =
  | string
  | number
  | boolean
  | null
  | JSONSerializable[]
  | { [key: string]: JSONSerializable };
type EventProperties = Record<string, JSONSerializable>;

class SudoQueryService {
  private isInitialized = false;

  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    const token = process.env.SUDO_QUERY_TOKEN as string | undefined;

    if (!token || token.trim() === '') {
      logger.warn('[SudoQuery] No token found in env, skipping initialization');
      return;
    }

    try {
      SudoQuery.init({
        token,
        flushInterval: 5000,
        batchSize: 10,
      });

      this.isInitialized = true;
      logger.info('[SudoQuery] Initialized successfully');
    } catch (error) {
      logger.error('[SudoQuery] Init failed:', error);
      this.isInitialized = false;
    }
  }

  identify(user: SudoQueryUser): void {
    if (!this.isInitialized) {
      this.initialize();
    }

    if (!this.isInitialized || !user?.id) {
      logger.warn('[SudoQuery] Identify skipped - not initialized or no user id');
      return;
    }

    try {
      SudoQuery.setUser(user.id);

      if (user.email) {
        SudoQuery.setSuperProperty('email', user.email);
      }
      if (user.name) {
        SudoQuery.setSuperProperty('name', user.name);
      }
    } catch (error) {
      logger.error('[SudoQuery] Identify failed:', error);
    }
  }

  track(eventName: string, properties?: EventProperties): void {
    if (!this.isInitialized) {
      logger.error('[SudoQuery] Track not initialized');
      return;
    }

    try {
      SudoQuery.track(eventName, properties || {});
    } catch (error) {
      logger.error('[SudoQuery] Track failed:', error);
    }
  }

  async flush(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      await SudoQuery.flush();
    } catch (error) {
      logger.error('[SudoQuery] Flush failed:', error);
    }
  }
}

export const sudoQueryService = new SudoQueryService();

export type { SudoQueryUser, EventProperties };