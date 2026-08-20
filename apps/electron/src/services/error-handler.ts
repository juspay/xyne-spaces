/**
 * Global Error Handler for Electron Application
 * 
 * Catches and logs all unhandled exceptions, promise rejections, 
 * process crashes, and other critical errors that could crash the application.
 */

import path from 'path';
import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { Logger, errorLogger } from './logger/Logger';
import ElectronEvent from './logger/electron-events';
import { getMainWindow, loadApp } from '../window/manager';
import { shouldRecoverFromReason, CrashRetryBudget } from './crash-recovery-policy';

/**
 * Sliding-window retry budget for main-window renderer recovery. Prevents an
 * infinite reload loop when the renderer hard-fails on load.
 */
const mainWindowRetryBudget = new CrashRetryBudget();

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
 * Recover the main window after its renderer dies.
 *
 * Historically this handler only logged, so a crashed main renderer left a
 * permanent blank window that only a manual Cmd+Shift+R could fix. We now
 * re-run loadApp() (which paints the branded loading splash first, then the
 * dashboard) so the app self-heals in ~1-2s, guarded by a retry budget so a
 * renderer that keeps failing on load falls back to an error page instead of
 * looping forever.
 */
function recoverMainWindow(window: BrowserWindow, reason: string): void {
  if (window !== getMainWindow() || window.isDestroyed()) {
    // Auxiliary windows (claw overlay, recording pill, etc.) register their own
    // per-window render-process-gone handlers and recover themselves.
    return;
  }

  if (!shouldRecoverFromReason(reason)) {
    return; // clean-exit / normal teardown — nothing to recover.
  }

  if (mainWindowRetryBudget.tryConsume()) {
    log.warn(`[ErrorHandler] Main renderer gone (${reason}); auto-recovering via loadApp()`);
    void loadApp(window).catch((error) => {
      log.error('[ErrorHandler] Auto-recovery loadApp failed:', error);
    });
    return;
  }

  // Budget exhausted — stop thrashing and show a terminal error page.
  log.error(`[ErrorHandler] Main renderer recovery budget exhausted (${reason}); showing error page`);
  const errorPage = path.join(__dirname, '..', '..', 'assets', 'load-error.html');
  void window.loadFile(errorPage).catch((error) => {
    log.error('[ErrorHandler] Failed to show load-error page:', error);
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

    // Auto-recover the main window so users no longer face a permanent white
    // screen requiring a manual reload.
    if (window) {
      recoverMainWindow(window, details.reason);
    }
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
