import * as Y from 'yjs';
import { createYjsProvider, EVENT_CONNECTION_STATUS } from '@y-sweet/client';
import type { YSweetProvider } from '@y-sweet/client';
import type { QueryClient } from '@tanstack/react-query';
import { canvasService } from './canvasService';
import type { YSweetAuthToken } from './canvasService';
import { logger, Event } from '../../utils/logger';

interface PrefetchedCanvas {
  doc: Y.Doc;
  provider: YSweetProvider;
  fragment: Y.XmlFragment;
  timestamp: number;
  isConnected: boolean;
}

class CanvasPrefetchService {
  private prefetchedCanvases = new Map<string, PrefetchedCanvas>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly MAX_PREFETCH_COUNT = 10; // Limit memory usage

  async prefetchCanvas(
    queryClient: QueryClient,
    canvasId: string,
    options?: {
      channelId?: string;
      title?: string;
    },
  ): Promise<void> {
    const existing = this.prefetchedCanvases.get(canvasId);
    if (existing && Date.now() - existing.timestamp < this.CACHE_TTL_MS) {
      return;
    }

    if (existing) {
      this.cleanup(canvasId);
    }

    if (this.prefetchedCanvases.size >= this.MAX_PREFETCH_COUNT) {
      this.evictOldest();
    }

    try {
      await canvasService.prefetchCanvas(queryClient, canvasId, options);

      const authToken = await queryClient.fetchQuery<YSweetAuthToken>({
        queryKey: ['ysweet-auth', canvasId, options?.channelId],
        queryFn: () =>
          canvasService.getYSweetAuthToken({
            docId: canvasId,
            ...(options?.channelId ? { channelId: options.channelId } : {}),
            ...(options?.title ? { title: options.title } : {}),
          }),
      });

      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('document-store');
      const actualDocId = authToken.docId || canvasId;

      let connectionResolve: (() => void) | null = null;
      const connectionPromise = new Promise<void>(resolve => {
        connectionResolve = resolve;
      });

      let syncResolve: (() => void) | null = null;
      const syncPromise = new Promise<void>(resolve => {
        syncResolve = resolve;
      });

      const getAuthToken = (): Promise<YSweetAuthToken> => {
        const data = queryClient.getQueryData<YSweetAuthToken>([
          'ysweet-auth',
          canvasId,
          options?.channelId,
        ]);
        if (!data) {
          return Promise.reject(new Error('Auth token not found in cache'));
        }
        return Promise.resolve(data);
      };

      const provider = createYjsProvider(doc, actualDocId, getAuthToken, {
        offlineSupport: true,
        warnOnClose: false,
        showDebuggerLink: false,
        connect: true,
      });

      const prefetchedCanvas: PrefetchedCanvas = {
        doc,
        provider,
        fragment,
        timestamp: Date.now(),
        isConnected: false,
      };

      const handleConnectionStatus = (
        status: 'offline' | 'connecting' | 'error' | 'handshaking' | 'connected',
      ): void => {
        if (status === 'connected') {
          prefetchedCanvas.isConnected = true;
          if (connectionResolve) {
            connectionResolve();
            connectionResolve = null;
          }
        }
      };

      let hasReceivedSync = false;
      const handleSync = (): void => {
        if (!hasReceivedSync && prefetchedCanvas.isConnected) {
          hasReceivedSync = true;
          logger.info(Event.CANVAS_SYNC_COMPLETE, { canvasId });
          if (syncResolve) {
            syncResolve();
            syncResolve = null;
          }
          doc.off('update', handleSync);
        }
      };

      doc.on('update', handleSync);
      provider.on(EVENT_CONNECTION_STATUS, handleConnectionStatus);

      const cleanupListeners = (): void => {
        doc.off('update', handleSync);
        provider.off(EVENT_CONNECTION_STATUS, handleConnectionStatus);
      };

      this.prefetchedCanvases.set(canvasId, prefetchedCanvas);

      const PREFETCH_TIMEOUT_MS = 5000;
      let timeoutId: NodeJS.Timeout | null = null;

      const cleanup = (): void => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        cleanupListeners();
      };

      const timeoutPromise = new Promise<'timeout'>(resolve => {
        timeoutId = setTimeout(() => {
          resolve('timeout');
        }, PREFETCH_TIMEOUT_MS);
      });

      try {
        const result = await Promise.race([
          Promise.all([connectionPromise, syncPromise]).then(() => 'success' as const),
          connectionPromise.then(
            () =>
              new Promise<'content-ready'>(resolve => {
                setTimeout(() => {
                  if (fragment.length > 0 || doc.store.clients.size > 0) {
                    resolve('content-ready');
                  }
                }, 100);
              }),
          ),
          timeoutPromise,
        ]);

        cleanup();

        if (result === 'timeout') {
          logger.warn(Event.CANVAS_PREFETCH_TIMEOUT, { canvasId });
        }
      } catch (innerError) {
        cleanup();
        throw innerError;
      }
    } catch (error) {
      logger.error(Event.CANVAS_PREFETCH_FAILED, {
        canvasId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.cleanup(canvasId);
    }
  }

  getPrefetchedCanvas(canvasId: string): PrefetchedCanvas | null {
    const canvas = this.prefetchedCanvases.get(canvasId);
    if (!canvas) return null;

    if (Date.now() - canvas.timestamp > this.CACHE_TTL_MS) {
      this.cleanup(canvasId);
      return null;
    }

    return canvas;
  }

  isPrefetched(canvasId: string): boolean {
    return this.getPrefetchedCanvas(canvasId) !== null;
  }

  consumePrefetchedCanvas(canvasId: string): PrefetchedCanvas | null {
    const canvas = this.getPrefetchedCanvas(canvasId);
    if (canvas) {
      this.prefetchedCanvases.delete(canvasId);
    }
    return canvas;
  }

  private cleanup(canvasId: string): void {
    const canvas = this.prefetchedCanvases.get(canvasId);
    if (canvas) {
      try {
        canvas.provider.destroy();
      } catch (error) {
        logger.error(Event.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error destroying prefetched provider:'),
          error: error,
        });
      }
      this.prefetchedCanvases.delete(canvasId);
    }
  }

  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [id, canvas] of this.prefetchedCanvases.entries()) {
      if (canvas.timestamp < oldestTimestamp) {
        oldestTimestamp = canvas.timestamp;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.cleanup(oldestId);
    }
  }
}

export const canvasPrefetchService = new CanvasPrefetchService();
