import { ChildProcess, spawn, execFile } from 'child_process';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import log from 'electron-log/main';
import { Logger } from './logger/Logger';
import ElectronEvent from './logger/electron-events';
import { showMeetingPopup, hideMeetingPopup } from './meeting-popup-window';
import { isMicOwnedByXyne } from './recording-controller';

// ── Types ──────────────────────────────────────────────────────────

type MeetingApp =
  | 'zoom'
  | 'microsoft-teams'
  | 'slack-huddle'
  | 'google-meet'
  | 'browser-meeting'
  | 'unknown';

interface MicEvent {
  event: 'mic_state' | 'device_changed' | 'app_activated' | 'error';
  active?: boolean;
  deviceId?: number;
  app?: string;
  bundleId?: string;
  message?: string;
}

interface MeetingInfo {
  app: MeetingApp;
  startedAt: string;
}

// ── Constants ──────────────────────────────────────────────────────

/**
 * Native app processes that indicate an active meeting.
 * Only processes exclusively present during an active call.
 */
const MEETING_PROCESS_MAP: Record<string, MeetingApp> = {
  'zoom.us': 'zoom',
  'CptHost': 'zoom',            // Zoom's audio capture host
  'MSTeams': 'microsoft-teams', // Teams new client
};

/** Bundle IDs / app names → meeting type (for frontmost app tracking) */
const MEETING_APP_BUNDLE_MAP: Record<string, MeetingApp> = {
  'com.tinyspeck.slackmacgap': 'slack-huddle',
  'com.microsoft.teams': 'microsoft-teams',
  'com.microsoft.teams2': 'microsoft-teams',
  'us.zoom.xos': 'zoom',
};

/**
 * Bundle ID prefixes for Chrome/Edge PWAs that are meeting apps.
 * Google Meet installed as a PWA has a bundle ID like:
 *   com.google.Chrome.app.kjgfgldnnfoeklkmfkjfagphfepbbdan
 * The suffix (app ID) can vary by Chrome install, so we match by prefix + known app IDs.
 */
const MEET_PWA_APP_IDS = new Set([
  'kjgfgldnnfoeklkmfkjfagphfepbbdan', // Google Meet PWA app ID
]);
const CHROME_PWA_PREFIX = 'com.google.Chrome.app.';

/** Browser bundle IDs */
const BROWSER_BUNDLE_IDS = new Set([
  'com.google.Chrome',
  'com.google.Chrome.canary',
  'company.thebrowser.Browser',    // Arc
  'com.microsoft.edgemac',
  'com.apple.Safari',
  'org.mozilla.firefox',
  'com.brave.Browser',
  'com.operasoftware.Opera',
  'com.vivaldi.Vivaldi',
]);

/**
 * Bundle IDs of apps that use the mic but are NOT meetings.
 * If one of these is the frontmost app when the mic activates, ignore it.
 */
const NON_MEETING_BUNDLE_IDS = new Set([
  'com.apple.screencaptureui',       // macOS screen recording
  'com.apple.Screenshot',            // macOS screenshot tool
  'com.apple.QuickTimePlayerX',      // QuickTime recording
  'com.apple.VoiceMemos',            // Voice Memos
  'com.apple.GarageBand',            // GarageBand
  'com.obsproject.obs-studio',       // OBS
  'com.adobe.Audition',              // Adobe Audition
  'org.audacityteam.audacity',       // Audacity
]);

/**
 * macOS screen recording processes. If any of these are running when the mic
 * activates, we treat it as a screen recording session, not a meeting.
 * Note: only include processes that are exclusively present during an active
 * recording — do NOT include background daemons that run permanently.
 */
const SCREEN_RECORDING_PROCESSES = new Set([
  'screencaptured',        // macOS screen recording daemon (only runs during active recording)
  'QuickTime Player',      // QuickTime recording (only runs when user opens it)
  'OBS',                   // OBS Studio
  'obs',
]);

const MEETING_END_DEBOUNCE_MS = 3000;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_MS = 2000;

// ── Service ────────────────────────────────────────────────────────

class MeetingDetectorService {
  private process: ChildProcess | null = null;
  private currentMeeting: MeetingInfo | null = null;
  private restartAttempts = 0;
  private lineBuffer = '';
  private meetingEndTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  /** Last known frontmost app — updated by app_activated events from the native binary */
  private lastFrontApp: { bundleId: string; name: string } | null = null;

  public start(): void {
    if (process.platform !== 'darwin') return;
    if (this.process) return;

    this.stopped = false;
    const binaryPath = this.getBinaryPath();

    log.info('[MeetingDetector] Starting mic-monitor:', binaryPath);
    Logger.info(ElectronEvent.MEETING_DETECTOR_START, { binaryPath }, 'MeetingDetector');

    try {
      this.process = spawn(binaryPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      this.process.stdout?.on('data', (chunk: Buffer) => {
        this.handleStdoutData(chunk);
      });

      this.process.stderr?.on('data', (chunk: Buffer) => {
        log.warn('[MeetingDetector] stderr:', chunk.toString().trim());
      });

      this.process.on('error', (err) => {
        log.error('[MeetingDetector] Process error:', err.message);
        Logger.logError(ElectronEvent.MEETING_DETECTOR_ERROR, err, {}, 'MeetingDetector');
        this.process = null;
        this.scheduleRestart();
      });

      this.process.on('exit', (code, signal) => {
        log.info(`[MeetingDetector] Process exited with code=${code} signal=${signal}`);
        Logger.info(ElectronEvent.MEETING_DETECTOR_PROCESS_EXIT, { code, signal }, 'MeetingDetector');
        this.process = null;

        if (!this.stopped && code !== 0) {
          this.scheduleRestart();
        }
      });
    } catch (err) {
      log.error('[MeetingDetector] Failed to spawn mic-monitor:', err);
      Logger.logError(ElectronEvent.MEETING_DETECTOR_ERROR, err, {}, 'MeetingDetector');
      this.scheduleRestart();
    }
  }

  public stop(): void {
    this.stopped = true;

    if (this.meetingEndTimer) {
      clearTimeout(this.meetingEndTimer);
      this.meetingEndTimer = null;
    }

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (!this.process) return;

    log.info('[MeetingDetector] Stopping mic-monitor');
    Logger.info(ElectronEvent.MEETING_DETECTOR_STOP, {}, 'MeetingDetector');

    const proc = this.process;
    this.process = null;

    proc.kill('SIGTERM');

    const forceKillTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Process already dead
      }
    }, 3000);

    proc.on('exit', () => {
      clearTimeout(forceKillTimer);
    });
  }

  public getCurrentMeeting(): MeetingInfo | null {
    return this.currentMeeting;
  }

  // ── Private ────────────────────────────────────────────────────

  private getBinaryPath(): string {
    if (app.isPackaged) {
      return path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'native',
        'mic-monitor',
        'mic-monitor'
      );
    }
    return path.join(app.getAppPath(), 'native', 'mic-monitor', 'mic-monitor');
  }

  private handleStdoutData(chunk: Buffer): void {
    this.lineBuffer += chunk.toString();
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event: MicEvent = JSON.parse(line);
        this.handleEvent(event);
      } catch {
        log.warn('[MeetingDetector] Failed to parse line:', line);
      }
    }
  }

  private handleEvent(event: MicEvent): void {
    if (event.event === 'app_activated') {
      this.handleAppActivated(event);
      return;
    }

    if (event.event === 'error') {
      log.error('[MeetingDetector] mic-monitor error:', event.message);
      return;
    }

    // mic_state or device_changed
    this.handleMicEvent(event);
  }

  private handleAppActivated(event: MicEvent): void {
    this.lastFrontApp = {
      bundleId: event.bundleId || '',
      name: event.app || '',
    };
  }

  private handleMicEvent(event: MicEvent): void {
    const active = event.active ?? false;

    if (active && !this.currentMeeting) {
      // A Xyne call or recording is what just turned the mic on. Bail out before
      // identifying anything — checkProcesses() would otherwise match a Zoom or
      // Teams that is merely open in the background.
      if (isMicOwnedByXyne()) {
        log.info('[MeetingDetector] Xyne call/recording in progress — ignoring mic activation');
        Logger.info(ElectronEvent.MEETING_POPUP_SKIPPED_RECORDING, { via: 'mic-activation' }, 'MeetingDetector');
        return;
      }

      log.info('[MeetingDetector] Mic became active — identifying meeting app');
      Logger.info(
        ElectronEvent.MEETING_MIC_ACTIVE,
        { deviceId: event.deviceId, hadPendingEndTimer: this.meetingEndTimer !== null },
        'MeetingDetector',
      );

      if (this.meetingEndTimer) {
        clearTimeout(this.meetingEndTimer);
        this.meetingEndTimer = null;
      }

      this.identifyMeetingApp()
        .then((meetingApp) => {
          if (meetingApp === 'unknown') {
            log.info('[MeetingDetector] Mic active but no supported meeting app detected');
            Logger.info(
              ElectronEvent.MEETING_APP_UNIDENTIFIED,
              { lastFrontApp: this.lastFrontApp },
              'MeetingDetector',
            );
            return;
          }

          this.currentMeeting = {
            app: meetingApp,
            startedAt: new Date().toISOString(),
          };

          log.info('[MeetingDetector] Meeting detected:', this.currentMeeting);
          Logger.info(ElectronEvent.MEETING_DETECTED, { ...this.currentMeeting }, 'MeetingDetector');
          this.notifyRenderer('meeting:detected', this.currentMeeting);
          showMeetingPopup(this.currentMeeting);
        })
        .catch((err) => {
          log.error('[MeetingDetector] Failed to identify meeting app:', err);
          Logger.logError(ElectronEvent.MEETING_DETECTOR_ERROR, err, { phase: 'identifyMeetingApp' }, 'MeetingDetector');
        });
    } else if (!active && this.currentMeeting) {
      if (this.meetingEndTimer) return;

      log.info('[MeetingDetector] Mic became inactive — debouncing meeting end');
      Logger.info(
        ElectronEvent.MEETING_MIC_INACTIVE,
        { app: this.currentMeeting.app, debounceMs: MEETING_END_DEBOUNCE_MS },
        'MeetingDetector',
      );

      this.meetingEndTimer = setTimeout(() => {
        this.meetingEndTimer = null;
        if (this.currentMeeting) {
          const meeting = this.currentMeeting;
          this.currentMeeting = null;

          log.info('[MeetingDetector] Meeting ended:', meeting);
          Logger.info(ElectronEvent.MEETING_ENDED, { ...meeting }, 'MeetingDetector');
          this.notifyRenderer('meeting:ended', meeting);
          hideMeetingPopup();
        }
      }, MEETING_END_DEBOUNCE_MS);
    }
  }

  /**
   * Detection strategy:
   * 1. Process check → Zoom app (CptHost/zoom.us), Teams app (MSTeams)
   *    Also checks for screen recording processes — if found, returns 'unknown'.
   * 2. Frontmost app check — uses lastFrontApp if available, otherwise queries
   *    the current frontmost app directly (covers the case where the browser was
   *    already open before the mic-monitor started and never fired app_activated).
   */
  private async identifyMeetingApp(): Promise<MeetingApp> {
    // 1. Check process list — for meeting processes and screen recording processes
    const { meetingApp, isScreenRecording } = await this.checkProcesses();
    if (isScreenRecording) {
      log.info('[MeetingDetector] Screen recording process detected, ignoring mic activation');
      Logger.info(ElectronEvent.MEETING_SCREEN_RECORDING_IGNORED, {}, 'MeetingDetector');
      return 'unknown';
    }
    if (meetingApp !== 'unknown') {
      Logger.info(ElectronEvent.MEETING_APP_IDENTIFIED, { app: meetingApp, via: 'process' }, 'MeetingDetector');
      return meetingApp;
    }

    // 2. Check frontmost app — use cached value or query live
    const frontApp = this.lastFrontApp ?? await this.queryFrontmostApp();
    const frontmostMatch = this.classifyApp(frontApp);
    if (frontmostMatch !== 'unknown') {
      Logger.info(
        ElectronEvent.MEETING_APP_IDENTIFIED,
        { app: frontmostMatch, via: 'frontmost', bundleId: frontApp?.bundleId },
        'MeetingDetector',
      );
      return frontmostMatch;
    }

    return 'unknown';
  }

  private checkProcesses(): Promise<{ meetingApp: MeetingApp; isScreenRecording: boolean }> {
    return new Promise((resolve) => {
      execFile('ps', ['-eo', 'comm='], (err, stdout) => {
        if (err) {
          resolve({ meetingApp: 'unknown', isScreenRecording: false });
          return;
        }

        let meetingApp: MeetingApp = 'unknown';
        const processNames = new Set<string>();

        for (const proc of stdout.split('\n')) {
          if (!proc.trim()) continue;
          const basename = proc.trim().split('/').pop() || '';
          processNames.add(basename);
        }

        // Screen recording takes priority — bail out immediately
        for (const p of processNames) {
          if (SCREEN_RECORDING_PROCESSES.has(p)) {
            resolve({ meetingApp: 'unknown', isScreenRecording: true });
            return;
          }
        }

        // Check for native meeting app processes (Zoom, Teams)
        for (const p of processNames) {
          const match = MEETING_PROCESS_MAP[p];
          if (match) {
            meetingApp = match;
            break;
          }
        }

        resolve({ meetingApp, isScreenRecording: false });
      });
    });
  }

  /**
   * Query the current frontmost app directly via lsappinfo.
   * Used as a fallback when lastFrontApp is null (e.g. browser was already
   * open before mic-monitor started and never fired an app_activated event).
   */
  private queryFrontmostApp(): Promise<{ bundleId: string; name: string } | null> {
    return new Promise((resolve) => {
      // Step 1: get the ASN of the frontmost app
      execFile('lsappinfo', ['front'], (err, asnOut) => {
        if (err || !asnOut.trim()) {
          resolve(null);
          return;
        }
        const asn = asnOut.trim();
        // Step 2: get bundleID and name for that ASN
        execFile('lsappinfo', ['info', '-only', 'bundleID', '-only', 'name', asn], (err2, infoOut) => {
          if (err2 || !infoOut) {
            resolve(null);
            return;
          }
          // Output format:
          //   "CFBundleIdentifier"="com.google.Chrome"
          //   "LSDisplayName"="Google Chrome"
          const bundleMatch = infoOut.match(/"CFBundleIdentifier"\s*=\s*"([^"]+)"/);
          const nameMatch = infoOut.match(/"LSDisplayName"\s*=\s*"([^"]+)"/);
          if (!bundleMatch) {
            resolve(null);
            return;
          }
          resolve({
            bundleId: bundleMatch[1],
            name: nameMatch ? nameMatch[1] : '',
          });
        });
      });
    });
  }

  /**
   * Classify a frontmost app as a meeting type or 'unknown'.
   */
  private classifyApp(frontApp: { bundleId: string; name: string } | null): MeetingApp {
    if (!frontApp) return 'unknown';

    const { bundleId } = frontApp;

    if (NON_MEETING_BUNDLE_IDS.has(bundleId)) {
      log.info('[MeetingDetector] Non-meeting app is frontmost, ignoring:', bundleId);
      Logger.info(ElectronEvent.MEETING_NON_MEETING_APP_IGNORED, { bundleId }, 'MeetingDetector');
      return 'unknown';
    }

    const meetingApp = MEETING_APP_BUNDLE_MAP[bundleId];
    if (meetingApp) {
      log.info('[MeetingDetector] Meeting app is frontmost:', bundleId);
      return meetingApp;
    }

    // Chrome PWA — check if it's a known meeting app (e.g. Google Meet installed as PWA)
    if (bundleId.startsWith(CHROME_PWA_PREFIX)) {
      const appId = bundleId.slice(CHROME_PWA_PREFIX.length);
      if (MEET_PWA_APP_IDS.has(appId)) {
        log.info('[MeetingDetector] Google Meet PWA is frontmost:', bundleId);
        return 'google-meet';
      }
    }

    // Browser → browser-based meeting (Meet, Zoom web, Teams web)
    // Note: browser screen recording also triggers this — no reliable way to
    // distinguish without inspecting browser tabs, which requires extra permissions.
    if (BROWSER_BUNDLE_IDS.has(bundleId)) {
      log.info('[MeetingDetector] Browser is frontmost:', bundleId);
      return 'browser-meeting';
    }

    return 'unknown';
  }

  private notifyRenderer(channel: string, data: unknown): void {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) {
        w.webContents.send(channel, data);
      }
    });
  }

  private scheduleRestart(): void {
    if (this.stopped) return;
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      log.error('[MeetingDetector] Max restart attempts reached, giving up');
      return;
    }

    this.restartAttempts++;
    const backoff = RESTART_BACKOFF_MS * Math.pow(2, this.restartAttempts - 1);

    log.info(`[MeetingDetector] Scheduling restart in ${backoff}ms (attempt ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS})`);
    Logger.info(ElectronEvent.MEETING_DETECTOR_RESTART, {
      attempt: this.restartAttempts,
      backoffMs: backoff,
    }, 'MeetingDetector');

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopped) {
        this.start();
      }
    }, backoff);
  }
}

export const meetingDetectorService = new MeetingDetectorService();
