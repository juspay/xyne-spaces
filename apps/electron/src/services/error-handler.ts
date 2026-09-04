/**
 * Global Error Handler for Electron Application
 * 
 * Catches and logs all unhandled exceptions, promise rejections, 
 * process crashes, and other critical errors that could crash the application.
 */

import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { Logger, errorLogger } from './logger/Logger';
import ElectronEvent from './logger/electron-events';

/**
 * Setup all global error handlers
 */
export function setupGlobalErrorHandlers(): void {
  log.info('[ErrorHandler] Setting up global error handlers...');


  // Start electron-log error catching
  log.errorHandler.startCatching({
    showDialog: false,
    onError: (error) => {
      errorLogger.error('[ErrorHandler] Electron Log caught error:', error);
      return true; // Continue to other handlers
    },
  });

  // Handle uncaught exceptions in main process
  // If the terminal that launched us goes away (pane closed, wrapper exited),
  // every console write fails with EIO/EPIPE. Without this guard the failure
  // surfaces as an uncaughtException, which we log to the console, which fails
  // again — a loop that filled ~1 MB of log every 30 s in dev. Drop the console
  // transport and keep going; the file transport is unaffected.
  const silenceConsoleOnDeadStdio = (error: NodeJS.ErrnoException): boolean => {
    if (error?.code !== 'EIO' && error?.code !== 'EPIPE') return false;
    if (log.transports['console'].level !== false) {
      log.transports['console'].level = false;
      log.warn('[ErrorHandler] stdout/stderr unavailable (' + error.code + '); console logging disabled');
    }
    return true;
  };
  for (const stream of [process.stdout, process.stderr]) {
    stream?.on('error', (error: NodeJS.ErrnoException) => {
      if (!silenceConsoleOnDeadStdio(error)) throw error;
    });
  }

  process.on('uncaughtException', (error: Error) => {
    if (silenceConsoleOnDeadStdio(error as NodeJS.ErrnoException)) return;
    Logger.logError(ElectronEvent.UNCAUGHT_EXCEPTION, error, {
      source: 'main_process',
      origin: 'uncaughtException',
    }, 'ErrorHandler');
    
    Logger.flushLogs();
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    Logger.logError(ElectronEvent.UNHANDLED_REJECTION, reason, {
      source: 'main_process',
      origin: 'unhandledRejection',
      promise_string: String(promise),
    }, 'ErrorHandler');
    
    Logger.flushLogs();
  });

  // Handle process warnings (memory leaks, deprecations, etc.)
  process.on('warning', (warning: Error) => {
    Logger.warn(ElectronEvent.UNCAUGHT_EXCEPTION, {
      source: 'main_process',
      origin: 'process_warning',
      warning_name: warning.name,
      warning_message: warning.message,
      warning_stack: warning.stack,
    }, 'ErrorHandler');

    Logger.flushLogs();
  });

  // Handle when app is ready to setup renderer-related handlers
  app.whenReady().then(() => {
    setupRendererErrorHandlers();
    setupChildProcessHandlers();
  });
}

/**
 * Setup error handlers for renderer processes
 */
function setupRendererErrorHandlers(): void {
  // Handle renderer process crashes/gone
  app.on('render-process-gone', (event, webContents, details) => {
    const window = BrowserWindow.fromWebContents(webContents);
    const windowTitle = window?.getTitle() || 'Unknown Window';

    Logger.error(ElectronEvent.UNCAUGHT_EXCEPTION, {
      source: 'renderer_process',
      origin: 'render_process_gone',
      reason: details.reason,
      exit_code: details.exitCode,
      window_title: windowTitle,
      window_id: window?.id,
    }, 'ErrorHandler');

    Logger.flushLogs();
  });

  // Monitor new windows as they're created
  app.on('browser-window-created', (_event, window) => {
    
    // Handle unresponsive renderer
    window.webContents.on('unresponsive', () => {
      Logger.warn(ElectronEvent.UNCAUGHT_EXCEPTION, {
        source: 'renderer_process',
        origin: 'webcontents_unresponsive',
        window_title: window.getTitle(),
        window_id: window.id,
      }, 'ErrorHandler');
      Logger.flushLogs();
    });
  });
}

/**
 * Setup handlers for child/utility processes
 */
function setupChildProcessHandlers(): void {
  // Handle child process crashes (utility processes, GPU, etc.)
  app.on('child-process-gone', (_event, details) => {
    Logger.error(ElectronEvent.UNCAUGHT_EXCEPTION, {
      source: 'child_process',
      origin: 'child_process_gone',
      process_type: details.type,
      reason: details.reason,
      exit_code: details.exitCode,
      service_name: details.serviceName,
      process_name: details.name,
    }, 'ErrorHandler');
    
    Logger.flushLogs();
  });
}
