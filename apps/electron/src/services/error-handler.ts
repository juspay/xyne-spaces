/**
 * Global Error Handler for Electron Application
 * 
 * Catches and logs all unhandled exceptions, promise rejections, 
 * process crashes, and other critical errors that could crash the application.
 */

import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { getIsQuitting } from '../app/app-state';
import { getMainWindow } from '../window/manager';
import { Logger, errorLogger } from './logger/Logger';
import ElectronEvent from './logger/electron-events';

const MAX_RENDERER_RELOAD_ATTEMPTS = 3;
// A crash long after the last one is treated as a fresh incident rather than
// counting against the same retry budget - otherwise a window that crashes
// once every few hours eventually exhausts its attempts and stops recovering.
const RENDERER_CRASH_RESET_WINDOW_MS = 60_000;

interface RendererCrashInfo {
  count: number;
  lastCrashAt: number;
}

const rendererCrashes = new Map<number, RendererCrashInfo>();

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

    // Scope auto-reload to the main window's own top-level renderer only.
    // - The recording pill and Claw overlay windows already run their own
    //   render-process-gone recovery (recording-pill-window.ts,
    //   claw-overlay-window.ts); reloading them here too would double-fire.
    // - `webContents` can belong to a <webview> guest or an attached
    //   BrowserView (e.g. the link preview) whose owner window resolves to
    //   the main window via BrowserWindow.fromWebContents, but reloading
    //   `window.webContents` in that case would reload the healthy main app
    //   and drop an active call/recording while leaving the actually-crashed
    //   guest blank.
    if (window !== getMainWindow() || webContents !== window.webContents) {
      return;
    }

    const now = Date.now();
    const previous = rendererCrashes.get(windowId);
    const count = previous && now - previous.lastCrashAt < RENDERER_CRASH_RESET_WINDOW_MS
      ? previous.count + 1
      : 1;
    rendererCrashes.set(windowId, { count, lastCrashAt: now });

    if (count > MAX_RENDERER_RELOAD_ATTEMPTS) {
      Logger.error(ElectronEvent.UNCAUGHT_EXCEPTION, {
        source: 'renderer_process',
        origin: 'render_process_gone_recovery',
        window_id: windowId,
        attempt: count,
        max_attempts: MAX_RENDERER_RELOAD_ATTEMPTS,
        reason: details.reason,
        action: 'give_up',
      }, 'ErrorHandler');
      Logger.flushLogs();
      return;
    }

    Logger.warn(ElectronEvent.UNCAUGHT_EXCEPTION, {
      source: 'renderer_process',
      origin: 'render_process_gone_recovery',
      window_id: windowId,
      attempt: count,
      max_attempts: MAX_RENDERER_RELOAD_ATTEMPTS,
      reason: details.reason,
      action: 'reload',
    }, 'ErrorHandler');
    Logger.flushLogs();
    window.webContents.reload();
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
    const logPayload = {
      source: 'child_process',
      origin: 'child_process_gone',
      process_type: details.type,
      reason: details.reason,
      exit_code: details.exitCode,
      service_name: details.serviceName,
      process_name: details.name,
    };

    // Routine teardown, not an error: a clean exit is always benign, and a
    // Utility process (e.g. the video capture service) being killed is the
    // normal way Chromium tears down an on-demand service. 'killed' on any
    // other process type (GPU, network, etc.) still indicates a real problem
    // and is logged as an error.
    const isRoutineTeardown =
      details.reason === 'clean-exit' ||
      (details.reason === 'killed' && details.type === 'Utility');

    if (isRoutineTeardown) {
      Logger.info(ElectronEvent.UNCAUGHT_EXCEPTION, logPayload, 'ErrorHandler');
    } else {
      Logger.error(ElectronEvent.UNCAUGHT_EXCEPTION, logPayload, 'ErrorHandler');
      Logger.flushLogs();
    }
  });
}
