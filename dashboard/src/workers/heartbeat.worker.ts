/**
 * Heartbeat Web Worker
 *
 * This worker runs in a separate thread and is NOT throttled by browsers
 * when the tab is in the background. It sends periodic 'tick' messages
 * to the main thread to trigger heartbeat emissions.
 *
 * Why a Web Worker?
 * - Browsers throttle setInterval in background tabs to once per minute (or less)
 * - This causes Redis TTL (90s) to expire, marking users offline incorrectly
 * - Web Workers are exempt from this throttling
 */

// Message types for type safety
type WorkerMessage = {
  type: 'start' | 'stop' | 'updateInterval';
  interval?: number;
};

type WorkerResponse = {
  type: 'tick' | 'started' | 'stopped';
};

let intervalId: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval = 30000; // 30 seconds default

/**
 * Start the heartbeat timer
 */
function startHeartbeat(): void {
  // Clear any existing interval
  if (intervalId) {
    clearInterval(intervalId);
  }

  // Send initial tick immediately
  self.postMessage({ type: 'tick' } as WorkerResponse);

  // Start the interval timer
  intervalId = setInterval(() => {
    self.postMessage({ type: 'tick' } as WorkerResponse);
  }, heartbeatInterval);

  self.postMessage({ type: 'started' } as WorkerResponse);
}

/**
 * Stop the heartbeat timer
 */
function stopHeartbeat(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  self.postMessage({ type: 'stopped' } as WorkerResponse);
}

/**
 * Handle messages from the main thread
 */
self.onmessage = (event: MessageEvent<WorkerMessage>): void => {
  const { type, interval } = event.data;

  switch (type) {
    case 'start':
      if (interval && interval > 0) {
        heartbeatInterval = interval;
      }
      startHeartbeat();
      break;

    case 'stop':
      stopHeartbeat();
      break;

    case 'updateInterval':
      if (interval && interval > 0) {
        heartbeatInterval = interval;
        // Restart with new interval if already running
        if (intervalId) {
          startHeartbeat();
        }
      }
      break;
  }
};

// Export empty object to make this a module (required for TypeScript)
export {};
