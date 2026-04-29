import { BrowserWindow, app, ipcMain } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import log from 'electron-log/main';

// IPC channels for error report recorder
const RECORDER_IPC = {
  START: 'error-report-recorder:start',
  STARTED: 'error-report-recorder:started',
  STOP: 'error-report-recorder:stop',
  CHUNK: 'error-report-recorder:chunk',
  STOPPED: 'error-report-recorder:stopped',
  ERROR: 'error-report-recorder:error',
} as const;

const RECORDING_FILE_PREFIX = 'xyne-error-recording-';

type RecordingState =
  | { state: 'idle' }
  | {
      state: 'recording';
      startTime: number;
      sourceId: string;
      withMic: boolean;
      tempFilePath: string;
      window: BrowserWindow;
    };

class ErrorReportRecorder {
  private state: RecordingState = { state: 'idle' };
  private writeStream: fs.WriteStream | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private stoppedHandler: ((event: Electron.IpcMainEvent) => void) | null = null;
  private chunkHandler: ((event: Electron.IpcMainEvent, chunk: ArrayBuffer) => void) | null = null;
  private errorHandler: ((event: Electron.IpcMainEvent, error: string) => void) | null = null;
  private crashHandler: ((event: Electron.Event, killed: boolean) => void) | null = null;
  private readonly tempDir = path.resolve(os.tmpdir());

  constructor() {
    // Register app quit handler to cleanup
    app.on('before-quit', () => {
      void this.cleanup();
    });
  }

  /**
   * Start recording screen/audio for error reporting
   * @param sourceId - The desktopCapturer source ID
   * @param withMic - Whether to include microphone audio
   */
  async startRecording(sourceId: string, withMic: boolean): Promise<void> {
    if (this.state.state === 'recording') {
      throw new Error('Recording already in progress');
    }

    // Cleanup any previous state
    await this.cleanup();

    const tempFilePath = path.join(
      os.tmpdir(),
      `${RECORDING_FILE_PREFIX}${crypto.randomUUID()}.webm`
    );

    log.info('[ErrorReportRecorder] Starting recording:', { sourceId, withMic, tempFilePath });

    // Create write stream
    this.writeStream = fs.createWriteStream(tempFilePath);

    // Create hidden BrowserWindow for recording.
    // nodeIntegration is required so the recorder HTML can use require('electron') directly.
    // This window only loads a trusted local file so the relaxed security is acceptable.
    const recorderWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
      },
    });

    // Load the recorder HTML
    const recorderHtml = path.join(__dirname, '..', '..', 'assets', 'error-report-recorder.html');
    await recorderWindow.loadFile(recorderHtml);

    // Set up IPC handlers for this recording session
    this.setupIpcHandlers();

    // Handle window crashes
    this.crashHandler = (_event: Electron.Event, killed: boolean): void => {
      log.error('[ErrorReportRecorder] Window crashed:', { killed, tempFilePath });
      this.cleanup();
    };
    recorderWindow.webContents.on('crashed' as any, this.crashHandler);

    // Update state
    this.state = {
      state: 'recording',
      startTime: Date.now(),
      sourceId,
      withMic,
      tempFilePath,
      window: recorderWindow,
    };

    const started = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ipcMain.removeListener(RECORDER_IPC.STARTED, onStarted);
        ipcMain.removeListener(RECORDER_IPC.ERROR, onStartError);
        void this.cleanup();
        reject(new Error('Timeout waiting for recording to start'));
      }, 10000);

      const onStarted = (): void => {
        clearTimeout(timeout);
        ipcMain.removeListener(RECORDER_IPC.ERROR, onStartError);
        resolve();
      };

      const onStartError = (_event: Electron.IpcMainEvent, error: string): void => {
        clearTimeout(timeout);
        ipcMain.removeListener(RECORDER_IPC.STARTED, onStarted);
        reject(new Error(error));
      };

      ipcMain.once(RECORDER_IPC.STARTED, onStarted);
      ipcMain.once(RECORDER_IPC.ERROR, onStartError);
    });

    // Notify renderer to start recording
    recorderWindow.webContents.send(RECORDER_IPC.START, { sourceId, withMic });
    await started;

    // Start progress timer (every 1 second)
    this.progressTimer = setInterval(() => {
      this.emitProgress();
    }, 1000);

    log.info('[ErrorReportRecorder] Recording started');
  }

  /**
   * Stop the current recording and return the file path
   */
  async stopRecording(): Promise<{ filePath: string }> {
    if (this.state.state !== 'recording') {
      throw new Error('No active recording');
    }

    const { window, tempFilePath } = this.state;

    log.info('[ErrorReportRecorder] Stopping recording');

    // Send stop signal to renderer
    window.webContents.send(RECORDER_IPC.STOP);

    // Wait for stopped event
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        void this.cleanup();
        reject(new Error('Timeout waiting for recording to stop'));
      }, 10000);

      const onStopped = (_event: Electron.IpcMainEvent): void => {
        clearTimeout(timeout);
        // Drain the write stream before resolving so the file is fully flushed
        const ws = this.writeStream;
        this.writeStream = null;
        const finish = (): void => {
          void this.cleanup();
          resolve({ filePath: tempFilePath });
        };
        if (ws) {
          ws.end(finish);
        } else {
          finish();
        }
      };

      // Store reference for cleanup
      this.stoppedHandler = onStopped;
      ipcMain.once(RECORDER_IPC.STOPPED, onStopped);
    });
  }

  /**
   * Get current recording state with elapsed time
   */
  getRecordingState(): { state: 'idle' | 'recording'; elapsedSeconds?: number } {
    if (this.state.state === 'recording') {
      const elapsedSeconds = Math.floor((Date.now() - this.state.startTime) / 1000);
      return { state: 'recording', elapsedSeconds };
    }

    return { state: 'idle' };
  }

  /**
   * Read a recording file and return as Buffer
   */
  async readRecordingFile(filePath: string): Promise<Buffer> {
    this.assertManagedRecordingPath(filePath);

    try {
      const buffer = await fs.promises.readFile(filePath);
      log.info('[ErrorReportRecorder] Read recording file:', { filePath, size: buffer.length });
      return buffer;
    } catch (error) {
      log.error('[ErrorReportRecorder] Failed to read recording file:', error);
      throw new Error(`Failed to read recording file: ${filePath}`);
    }
  }

  /**
   * Delete a temporary recording file
   */
  async cleanupRecordingFile(filePath: string): Promise<void> {
    this.assertManagedRecordingPath(filePath);

    try {
      await fs.promises.unlink(filePath);
      log.info('[ErrorReportRecorder] Cleaned up recording file:', filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error('[ErrorReportRecorder] Failed to cleanup recording file:', error);
        throw error;
      }
    }
  }

  assertManagedRecordingPath(filePath: string): void {
    const resolvedPath = path.resolve(filePath);
    const fileName = path.basename(resolvedPath);

    if (
      path.dirname(resolvedPath) !== this.tempDir ||
      !fileName.startsWith(RECORDING_FILE_PREFIX) ||
      path.extname(fileName) !== '.webm'
    ) {
      throw new Error('Invalid recording file path');
    }
  }

  /**
   * Set up IPC handlers for recording session
   */
  private setupIpcHandlers(): void {
    // Handle incoming chunks
    this.chunkHandler = (_event: Electron.IpcMainEvent, chunk: ArrayBuffer): void => {
      if (this.writeStream && this.state.state === 'recording') {
        const buffer = Buffer.from(chunk);
        this.writeStream.write(buffer);
      }
    };
    ipcMain.on(RECORDER_IPC.CHUNK, this.chunkHandler);

    // Handle errors from recorder
    this.errorHandler = (_event: Electron.IpcMainEvent, error: string): void => {
      log.error('[ErrorReportRecorder] Recorder error:', error);
      if (this.stoppedHandler) {
        return;
      }
      void this.cleanup();
    };
    ipcMain.on(RECORDER_IPC.ERROR, this.errorHandler);
  }

  /**
   * Emit progress event to main window
   */
  private emitProgress(): void {
    const state = this.getRecordingState();
    
    // Broadcast to all windows
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('error-report:recording-progress', {
          elapsedSeconds: state.elapsedSeconds ?? 0,
        });
      }
    });
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    log.info('[ErrorReportRecorder] Cleaning up');

    // Clear progress timer
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }

    // Close write stream
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }

    // Remove IPC handlers
    if (this.chunkHandler) {
      ipcMain.removeListener(RECORDER_IPC.CHUNK, this.chunkHandler);
      this.chunkHandler = null;
    }

    if (this.errorHandler) {
      ipcMain.removeListener(RECORDER_IPC.ERROR, this.errorHandler);
      this.errorHandler = null;
    }

    if (this.stoppedHandler) {
      ipcMain.removeListener(RECORDER_IPC.STOPPED, this.stoppedHandler);
      this.stoppedHandler = null;
    }

    // Close and destroy window
    if (this.state.state === 'recording') {
      const { window } = this.state;

      if (this.crashHandler) {
        window.webContents.off('crashed' as any, this.crashHandler);
        this.crashHandler = null;
      }

      if (!window.isDestroyed()) {
        window.close();
      }
    }

    this.state = { state: 'idle' };
    log.info('[ErrorReportRecorder] Cleanup complete');
  }
}

export const errorReportRecorder = new ErrorReportRecorder();
