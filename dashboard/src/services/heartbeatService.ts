/**
 * Heartbeat Service
 *
 * Manages a Web Worker-based heartbeat mechanism that is immune to browser
 * background tab throttling. This ensures users remain marked as "online"
 * even when the tab is in the background.
 *
 * Architecture:
 * - Web Worker runs setInterval in a separate thread (not throttled)
 * - Worker posts 'tick' messages to main thread every 30s
 * - Main thread receives ticks and emits 'user_activity' via socket
 * - If socket is disconnected, falls back to HTTP POST for heartbeat
 * - visibilitychange listener provides additional backup for immediate heartbeat
 */

import { websocketService } from './clients/socketClient';
import { API_BASE_URL } from '../config';

// Worker message types
type WorkerMessage = {
  type: 'start' | 'stop' | 'updateInterval';
  interval?: number;
};

type WorkerResponse = {
  type: 'tick' | 'started' | 'stopped';
};

// Default heartbeat interval (30 seconds)
const DEFAULT_HEARTBEAT_INTERVAL = 30000;

class HeartbeatService {
  private worker: Worker | null = null;
  private isRunning = false;
  private handleVisibilityChange: (() => void) | null = null;

  /**
   * Initialize the Web Worker
   * Uses Vite's ?worker import syntax for proper bundling
   */
  private initWorker(): void {
    if (this.worker) {
      return;
    }

    try {
      // Create worker using Vite's worker import pattern
      // The ?worker suffix tells Vite to handle this as a Web Worker
      this.worker = new Worker(new URL('../workers/heartbeat.worker.ts', import.meta.url), {
        type: 'module',
      });

      // Handle messages from the worker
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { type } = event.data;

        switch (type) {
          case 'tick':
            this.sendHeartbeat();
            break;
          case 'started':
            console.log('[HeartbeatService] ✅ Worker started - heartbeats will be sent every 30s');
            break;
          case 'stopped':
            console.log('[HeartbeatService] ⏹️ Worker stopped');
            break;
        }
      };

      this.worker.onerror = error => {
        console.error('[HeartbeatService] ❌ Worker error:', error);
        // Fallback: if worker fails, we still have visibilitychange listener
      };
    } catch (error) {
      console.error('[HeartbeatService] ❌ Failed to create worker:', error);
      // Worker creation failed - will rely on visibilitychange as fallback
    }
  }

  /**
   * Send heartbeat to the backend via socket, with HTTP fallback
   * If socket is disconnected or doesn't acknowledge within timeout, uses HTTP POST
   *
   * The acknowledgment is critical because socket.connected can be true even when
   * the connection is in a zombie state (especially in background tabs where the
   * TCP connection may have been silently broken)
   */
  private sendHeartbeat(): void {
    const socket = websocketService.getSocket();

    if (socket && socket.connected) {
      // Primary path: use socket with acknowledgment
      // Set a timeout - if no ack within 5 seconds, fall back to HTTP
      const ackTimeout = setTimeout(() => {
        this.sendHttpHeartbeat();
      }, 5000);

      socket.emit('user_activity', {}, (ack: { success: boolean }) => {
        clearTimeout(ackTimeout);
        if (!ack?.success) {
          this.sendHttpHeartbeat();
        }
      });
    } else {
      // Fallback path: use HTTP when socket is disconnected
      // This ensures heartbeat reaches server even if socket died in background tab
      this.sendHttpHeartbeat();
    }
  }

  /**
   * Send heartbeat via HTTP POST (fallback when socket is unavailable)
   * Using fetch() instead of axios because we need the 'keepalive' option
   * which allows the request to complete even if the tab is being closed/throttled
   */
  private sendHttpHeartbeat(): void {
    // eslint-disable-next-line local-rules/no-fetch-use-axios -- fetch is required for keepalive support
    fetch(`${API_BASE_URL}/user-status/activity`, {
      method: 'POST',
      credentials: 'include', // Include cookies for auth
      headers: {
        'Content-Type': 'application/json',
      },
      keepalive: true, // Allows request to outlive the page
    }).catch(() => {
      // Silently ignore HTTP heartbeat failures
    });
  }

  /**
   * Start the heartbeat mechanism
   * @param interval - Optional custom interval in milliseconds (default: 30000)
   */
  start(interval: number = DEFAULT_HEARTBEAT_INTERVAL): void {
    if (this.isRunning) {
      console.debug('[HeartbeatService] Already running');
      return;
    }

    this.isRunning = true;

    // Initialize and start the Web Worker
    this.initWorker();
    if (this.worker) {
      const message: WorkerMessage = { type: 'start', interval };
      this.worker.postMessage(message);
    }

    // Set up visibility change listener as a backup mechanism
    // This ensures immediate heartbeat AND socket reconnect when user returns to tab
    this.handleVisibilityChange = (): void => {
      if (!document.hidden) {
        console.debug('[HeartbeatService] Tab became visible, sending immediate heartbeat');

        // First, try to reconnect the socket if it's disconnected
        const socket = websocketService.getSocket();
        if (!socket || !socket.connected) {
          console.debug('[HeartbeatService] Socket disconnected, triggering reconnect');
          websocketService.reconnect();
        }

        // Send heartbeat (will use HTTP fallback if socket still not connected)
        this.sendHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    console.log('[HeartbeatService] 🚀 Started with interval:', interval, 'ms');
  }

  /**
   * Stop the heartbeat mechanism
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Stop the worker
    if (this.worker) {
      const message: WorkerMessage = { type: 'stop' };
      this.worker.postMessage(message);
    }

    // Remove visibility change listener
    if (this.handleVisibilityChange) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.handleVisibilityChange = null;
    }
  }

  /**
   * Terminate the worker completely (for cleanup)
   */
  terminate(): void {
    this.stop();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Check if the heartbeat service is currently running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Update the heartbeat interval while running
   * @param interval - New interval in milliseconds
   */
  updateInterval(interval: number): void {
    if (this.worker && interval > 0) {
      const message: WorkerMessage = { type: 'updateInterval', interval };
      this.worker.postMessage(message);
    }
  }
}

// Export singleton instance
const heartbeatService = new HeartbeatService();
export default heartbeatService;
