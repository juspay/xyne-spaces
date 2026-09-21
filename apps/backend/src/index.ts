import { App } from './app.js';
import { logger } from '@/utils/logger';
import { configureJAF } from '@juspay-jaf/jaf';
import { warnIfNoGoogleClientsConfigured } from '@/services/googleOAuthClients';

configureJAF({ verbose: false });

process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
  try {
    // Safely extract error message without causing "Invalid string length" crash
    let errorMsg = 'Unknown error';
    if (reason instanceof Error) {
      errorMsg = reason.message;
    } else if (typeof reason === 'string') {
      errorMsg = reason;
    } else {
      errorMsg = String(reason).substring(0, 500);
    }

    logger.error('UNHANDLED REJECTION', {
      message: errorMsg,
      type: reason instanceof Error ? reason.constructor.name : typeof reason,
    });
  } catch (loggingError) {
    console.error('Failed to log unhandled rejection:', loggingError);
  }
});

process.on('uncaughtException', (error: Error) => {
  try {
    logger.error('UNCAUGHT EXCEPTION', {
      message: error.message,
      name: error.name,
      stack: error.stack?.substring(0, 1000),
    });
  } catch (loggingError) {
    console.error('Failed to log uncaught exception:', loggingError);
  }
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
    warnIfNoGoogleClientsConfigured();
    app = new App();
    await app.listen();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
