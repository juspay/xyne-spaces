/**
 * Global Error Handler for Electron Application
 * 
 * Catches and logs all unhandled exceptions, promise rejections, 
 * process crashes, and other critical errors that could crash the application.
 */

import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { getIsQuitting } from '../app/app-state';
import { Logger, errorLogger } from './logger/Logger';
import ElectronEvent from './logger/electron-events';

const MAX_RENDERER_RELOAD_ATTEMPTS = 3;
const rendererReloadAttempts = new Map<number, number>();

// child-process-gone fires for on-demand utility processes (e.g. the video
// capture service) tearing down normally, not just for real crashes. Only
// escalate to an error log for reasons that indicate an actual problem so
// routine camera/screen-share lifecycle churn doesn't flood error logs.
const CHILD_PROCESS_ERROR_REASONS = new Set<string>([
  'crashed',
  'abnormal-exit',
  'oom',
  'launch-failed',
  'integrity-failure',
]);

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
  process.on('uncaughtException', (error: Error) => {
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
    const windowId = window?.id;

    Logger.error(ElectronEvent.UNCAUGHT_EXCEPTION, {
      source: 'renderer_process',
      origin: 'render_process_gone',
      reason: details.reason,
      exit_code: details.exitCode,
      window_title: windowTitle,
      window_id: windowId,
    }, 'ErrorHandler');

    Logger.flushLogs();

    if (!window || window.isDestroyed() || windowId === undefined) {
      return;
    }

    // App is intentionally shutting down (e.g. Cmd+Q) - don't fight it by
    // reviving a window that's about to be torn down anyway.
    if (getIsQuitting()) {
      return;
    }

    const attempts = rendererReloadAttempts.get(windowId) ?? 0;
    if (attempts >= MAX_RENDERER_RELOAD_ATTEMPTS) {
      log.error(`[ErrorHandler] Renderer for window ${windowId} crashed ${attempts} times, giving up on auto-reload`);
      return;
    }

    rendererReloadAttempts.set(windowId, attempts + 1);
    log.warn(`[ErrorHandler] Reloading crashed renderer for window ${windowId} (attempt ${attempts + 1}/${MAX_RENDERER_RELOAD_ATTEMPTS}, reason: ${details.reason})`);
    window.webContents.reload();
  });

  // Monitor new windows as they're created
  app.on('browser-window-created', (_event, window) => {

    // A successful load means the renderer recovered; reset its crash count
    // so a later, unrelated crash still gets the full retry budget.
    window.webContents.on('did-finish-load', () => {
      rendererReloadAttempts.delete(window.id);
    });

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
    const logPayload = {
      source: 'child_process',
      origin: 'child_process_gone',
      process_type: details.type,
      reason: details.reason,
      exit_code: details.exitCode,
      service_name: details.serviceName,
      process_name: details.name,
    };

    if (CHILD_PROCESS_ERROR_REASONS.has(details.reason)) {
      Logger.error(ElectronEvent.UNCAUGHT_EXCEPTION, logPayload, 'ErrorHandler');
      Logger.flushLogs();
    } else {
      // Routine teardown (e.g. 'clean-exit', or 'killed' when Chromium tears
      // down an on-demand utility process like video capture) - not an error.
      Logger.info(ElectronEvent.UNCAUGHT_EXCEPTION, logPayload, 'ErrorHandler');
    }
  });
}
