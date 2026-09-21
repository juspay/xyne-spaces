import { App } from './app.js';
import { describeRejection, logger } from '@/utils/logger';
import { configureJAF } from '@juspay-jaf/jaf';
import { warnIfNoGoogleClientsConfigured } from '@/services/googleOAuthClients';

configureJAF({ verbose: false });

process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
  logger.error('UNHANDLED REJECTION', {
    error: describeRejection(reason),
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('UNCAUGHT EXCEPTION', {
    error,
  });
});


/**
 * Upper bound on the whole shutdown. If a queue or database close hangs, the
 * process still exits on its own instead of riding the grace period out to a
 * SIGKILL — which would drop whatever the drain had already finished.
 */
const SHUTDOWN_HARD_EXIT_MS = 25_000;

let shuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (shuttingDown) {
    logger.warn(`Received ${signal} while already shutting down, ignoring`);
    return;
  }
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully`);

  const hardExit = setTimeout(() => {
    logger.error('Shutdown exceeded hard deadline, exiting now');
    process.exit(1);
  }, SHUTDOWN_HARD_EXIT_MS);
  hardExit.unref();

  if (app) {
    await app.shutdown();
  }

  logger.info('Graceful shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Initialize and start the application
let app: App;

async function startServer() {
  try {
    warnIfNoGoogleClientsConfigured();
    app = new App();
    await app.listen();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
