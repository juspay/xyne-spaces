import { App } from './app.js';
import { describeRejection, logger } from '@/utils/logger';
import { configureJAF } from '@juspay-jaf/jaf';

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
