import { App } from './app.js';
import { logger, serializeError } from '@/utils/logger';
import { configureJAF } from '@juspay-jaf/jaf';

configureJAF({ verbose: false });

/**
 * A rejection reason is often not an Error. Errors go through the shared
 * allowlist serializer; anything else is described rather than serialized,
 * since an arbitrary value may be circular and JSON.stringify would throw
 * inside the last-resort handler.
 */
function describeRejection(reason: unknown): Record<string, unknown> {
  if (reason instanceof Error) {
    return serializeError(reason);
  }
  return {
    message: 'Non-error rejection',
    type: typeof reason,
    value: typeof reason === 'object' ? Object.prototype.toString.call(reason) : String(reason),
  };
}

process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
  logger.error('UNHANDLED REJECTION', {
    error: describeRejection(reason),
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('UNCAUGHT EXCEPTION', {
    error: serializeError(error),
  });
});


const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully`);

  if (app) {
    await app.shutdown();
  }

  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Initialize and start the application
let app: App;

async function startServer() {
  try {
    app = new App();
    await app.listen();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
