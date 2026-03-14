# Meeting Detector — Feature Overview

## What it does

When the user is on a macOS meeting (Zoom, Google Meet, Microsoft Teams, Slack Huddle), Xyne automatically detects it and shows a non-intrusive popup at the top of the screen:

> **Meeting detected — Zoom**
> [Start recording]  ✕

Clicking **Start recording** begins recording silently in the background — the user stays in their meeting, the popup closes, and Xyne starts capturing without pulling focus away. The popup auto-dismisses after 15 seconds if ignored, and disappears when the meeting ends.

The feature is **macOS-only** and has no effect on Windows or Linux.

---

## How detection works

### Step 1 — Mic activation (native binary)

A lightweight native binary (`mic-monitor`) runs in the background. It uses Apple's CoreAudio APIs to listen for when the system microphone turns on or off. No polling — it's fully event-driven.

When the mic turns on, `mic-monitor` emits a JSON event to the Electron app:
```json
{"event":"mic_state","active":true,"deviceId":42}
```

It also continuously tracks which app is in the foreground using macOS `NSWorkspace` notifications, and reports every app switch:
```json
{"event":"app_activated","app":"Google Chrome","bundleId":"com.google.Chrome"}
```

This stream of app-switch events is how we know *what the user was doing* when the mic turned on.

### Step 2 — Identify the meeting app

When the mic activates, the app runs identification in two steps:

---

#### Process check (runs first)

Scans the full list of running processes via `ps -eo comm=`.

**Screen recording bail-out:** If any of these processes are found, it's treated as a screen recording — not a meeting — and detection stops immediately:

| Process | Tool |
|---------|------|
| `screencaptured` | macOS Cmd+Shift+5 recording daemon |
| `QuickTime Player` | QuickTime screen/audio recording |
| `OBS` / `obs` | OBS Studio |

**Meeting process match:** If a known meeting-app process is found, detection succeeds immediately without needing to check the frontmost app:

| Process | App |
|---------|-----|
| `zoom.us`, `CptHost` | Zoom (CptHost is Zoom's audio capture subprocess) |
| `MSTeams` | Microsoft Teams (new client) |

---

#### Frontmost app check (fallback)

If the process check doesn't find a meeting app, we fall back to checking which app the user was focused on when the mic turned on.

**How `lastFrontApp` works:**
The native binary fires an `app_activated` event every time the user switches to a different app. The TypeScript service caches this as `lastFrontApp`. So when the mic turns on, we already know the most recent foreground app without any additional system calls.

**The edge case — app was open before Xyne started:**
If the user had Chrome (or any other app) open before launching Xyne, no `app_activated` event was ever fired for it. In this case `lastFrontApp` is stale or null. To handle this, we fall back to a live query using `lsappinfo` — a macOS system tool that returns the current frontmost app instantly.

**App classification:**

| App | Bundle ID | Meeting Type |
|-----|-----------|--------------|
| Slack | `com.tinyspeck.slackmacgap` | Slack Huddle |
| Microsoft Teams (old) | `com.microsoft.teams` | Microsoft Teams |
| Microsoft Teams (new) | `com.microsoft.teams2` | Microsoft Teams |
| Zoom | `us.zoom.xos` | Zoom |
| Google Meet PWA | `com.google.Chrome.app.kjgfgldnnfoeklkmfkjfagphfepbbdan` | Google Meet |
| Any browser | `com.google.Chrome`, `com.apple.Safari`, Arc, Firefox, etc. | Browser Meeting |

Google Meet installed as a PWA ("Add to Dock" from Chrome) gets its own bundle ID in the format `com.google.Chrome.app.<app-id>`. We match the known app ID suffix.

**Non-meeting apps explicitly ignored** (if these are frontmost, detection returns no result):

- `com.apple.screencaptureui` — macOS screen recording toolbar
- `com.apple.QuickTimePlayerX` — QuickTime
- `com.apple.VoiceMemos`, `com.apple.GarageBand`
- `com.obsproject.obs-studio` — OBS
- `com.adobe.Audition`, `org.audacityteam.audacity`

If nothing matches → no popup shown.

---

### Step 3 — Show popup

A separate `BrowserWindow` (frameless, transparent, always-on-top) slides in at the top-center of the screen. It floats above full-screen apps. The window is shown with `showInactive()` so it never steals focus from the meeting. Clicking the buttons focuses the popup briefly, but it blurs itself immediately after the IPC action so focus returns to the meeting app.

The popup auto-dismisses after **15 seconds**. When the mic turns off and stays off for **3 seconds** (debounce to handle brief mic pauses), the popup hides.

---

## Architecture

```
native/mic-monitor/main.c          C binary — CoreAudio + NSWorkspace
         │  stdout (JSON lines)
         ▼
src/services/meeting-detector.ts   TypeScript — identifies meeting, fires events
         │
         ├──▶ src/services/meeting-popup-window.ts   Creates/manages popup BrowserWindow
         │              │  IPC
         │              ▼
         │         assets/meeting-popup.html          Popup UI (standalone HTML)
         │
         └──▶ src/ipc/handlers.ts                    Handles popup actions (start recording, dismiss)
                        │  IPC
                        ▼
         dashboard/src/components/NotificationHandler/NotificationHandler.tsx
                        │
                        ▼
         dashboard/src/routes/RecordingsScreen/RecordingsScreen.tsx  (auto-starts recording)
```

### Key files

| File | Purpose |
|------|---------|
| `native/mic-monitor/main.c` | Native C binary — mic state + app activation events |
| `src/services/meeting-detector.ts` | Core detection logic |
| `src/services/meeting-popup-window.ts` | Popup window lifecycle |
| `assets/meeting-popup.html` | Popup UI |
| `src/ipc/handlers.ts` | IPC handlers for popup actions and toggle |
| `src/preload.ts` | Exposes `meetingDetector` and `meetingPopup` APIs to renderer |
| `src/app/main.ts` | Starts/stops the detector with the app |
| `dashboard/src/hooks/useMeetingDetectionSettings.ts` | Toggle preference (localStorage) |
| `dashboard/src/components/Settings/Settings.tsx` | Settings UI toggle |
| `dashboard/src/components/NotificationHandler/NotificationHandler.tsx` | Syncs preference, handles start-recording signal |
| `dashboard/src/routes/RecordingsScreen/RecordingsScreen.tsx` | Auto-starts recording on mount if flagged |

---

## User controls

The user can turn meeting detection on or off in **Profile → Notifications → Meeting Detection**. The preference is stored in `localStorage` and synced to the main process on startup. When disabled, the mic-monitor binary is stopped entirely.

---

## False positive prevention

| Scenario | Handled by |
|----------|-----------|
| Screen recording with Cmd+Shift+5 + mic | `screencaptured` process check — bails out before any app check |
| QuickTime / OBS recording | Process check + bundle ID blocklist |
| Voice Memos, GarageBand, Audacity | Bundle ID blocklist |
| Slack screen share (not a huddle) | User switches focus away from Slack to the thing they're recording; `lastFrontApp` updates away from Slack |
| Browser screen recording | Partial — cannot distinguish from a browser meeting without inspecting tab content (would require extra permissions) |

---

## Platform support

- **macOS** — fully supported (macOS 10.15+ / Catalina and later)
- **Windows / Linux** — feature does not run; all code is guarded with `process.platform !== 'darwin'`

---

## End-to-end flows

### Flow 1 — Happy path: user joins a Zoom call and starts recording

```
User opens Zoom and joins a call
  │
  ▼
mic-monitor (C binary) detects mic activation
  │  stdout: {"event":"mic_state","active":true,"deviceId":42}
  ▼
MeetingDetectorService.handleMicEvent()
  │  active=true, no currentMeeting → run identifyMeetingApp()
  ▼
checkProcesses()  [ps -eo comm=]
  │  finds "zoom.us" or "CptHost" → meetingApp = "zoom"
  │  no screen recording processes → isScreenRecording = false
  ▼
currentMeeting = { app: "zoom", startedAt: "..." }
notifyRenderer("meeting:detected", ...)   → dashboard renderer receives IPC
showMeetingPopup({ app: "zoom", ... })
  │
  ▼
MeetingPopupWindow
  │  checks session cookies → google_access_token present → user is logged in
  │  creates frameless BrowserWindow, loads meeting-popup.html
  │  webContents "did-finish-load" → sends "meeting-popup:show" to popup
  │  popup renderer reports its height via IPC "meeting-popup:content-height"
  │  window resized, shown with showInactive() → blurred immediately
  │  15-second auto-dismiss timer starts
  ▼
Popup visible at top-center of screen: "Meeting detected — Zoom  [Start recording] ✕"
  │
  │  User clicks "Start recording" within 15 seconds
  ▼
Popup IPC → ipcMain handler (handlers.ts)
  │  sends IPC to all renderer windows: "meeting-detector:start-recording"
  ▼
NotificationHandler (dashboard)
  │  onStartRecordingFromMeeting fires
  │  calls setPendingAutoStartRecording() → sets module-level flag
  ▼
User is navigated to /recordings (or already there)
RecordingsScreen mounts
  │  reads pendingAutoStartRecording flag → true
  │  clears flag, triggers auto-start recording flow
  ▼
Recording starts silently — user stays in Zoom
```

---

### Flow 2 — User ignores the popup (auto-dismiss)

```
Popup appears (meeting detected)
  │
  │  User does nothing for 15 seconds
  ▼
AUTO_DISMISS_MS timeout fires in meeting-popup-window.ts
  │  calls hideMeetingPopup()
  ▼
"meeting-popup:hide" IPC sent to popup renderer
  │  CSS slide-out animation plays (300 ms)
  ▼
hideTimer fires after 300 ms
  │  popupWindow.close()
  ▼
Popup closed. Meeting continues. No recording started.
```

---

### Flow 3 — User dismisses the popup manually (✕ button)

```
Popup is visible
  │
  │  User clicks ✕
  ▼
Popup renderer sends IPC "meeting-popup:dismiss"
  │
  ▼
ipcMain handler (handlers.ts)
  │  calls hideMeetingPopup()
  ▼
Same close sequence as Flow 2 (animate out → close)
  │
Popup closed. No recording started.
```

---

### Flow 4 — Meeting ends before user interacts

```
User is in a call, popup is visible (or already dismissed)
  │
  │  User leaves the call / mutes mic / call ends
  ▼
mic-monitor detects mic deactivated
  │  stdout: {"event":"mic_state","active":false}
  ▼
MeetingDetectorService.handleMicEvent()
  │  active=false, currentMeeting set → start 3-second debounce timer
  │  (debounce absorbs brief mic pauses, e.g. mute-unmute quickly)
  │
  │  Mic stays off for 3 seconds
  ▼
MEETING_END_DEBOUNCE_MS timeout fires
  │  currentMeeting = null
  │  notifyRenderer("meeting:ended", ...)
  │  hideMeetingPopup()
  ▼
Popup slides out and closes (if still visible)
```

---

### Flow 5 — Screen recording false-positive prevention

```
User starts Cmd+Shift+5 screen recording with mic enabled
  │
  ▼
mic-monitor detects mic activation
  │
  ▼
identifyMeetingApp() → checkProcesses()
  │  finds "screencaptured" process in ps output
  │  isScreenRecording = true → returns "unknown" immediately
  ▼
No popup shown. No recording triggered.
```

Same bail-out applies for: QuickTime Player recording, OBS Studio.

---

### Flow 6 — Browser-based meeting (e.g. Google Meet in Chrome)

```
User is on meet.google.com in Chrome, joins a call
  │
  ▼
mic-monitor detects mic activation
  │  has been firing app_activated events → lastFrontApp = { bundleId: "com.google.Chrome", ... }
  ▼
identifyMeetingApp()
  │  checkProcesses() → no zoom.us, CptHost, MSTeams found → meetingApp = "unknown"
  │  no screen recording processes
  │
  ▼
classifyApp({ bundleId: "com.google.Chrome" })
  │  not in NON_MEETING_BUNDLE_IDS
  │  not in MEETING_APP_BUNDLE_MAP
  │  not a Chrome PWA prefix
  │  IS in BROWSER_BUNDLE_IDS → returns "browser-meeting"
  ▼
Popup shown: "Meeting detected — Browser  [Start recording] ✕"
  │
  └── User flow continues as Flow 1 from here
```

**Edge case — Chrome was open before Xyne started:**
`lastFrontApp` is null (no `app_activated` ever fired for it). Falls back to `queryFrontmostApp()` via `lsappinfo front` → live query returns Chrome bundle ID → same classification path above.

---

### Flow 7 — Google Meet PWA (installed via "Add to Dock")

```
User opens Google Meet PWA, joins a call
  │
  ▼
app_activated fires: bundleId = "com.google.Chrome.app.kjgfgldnnfoeklkmfkjfagphfepbbdan"
  │
  ▼
classifyApp()
  │  bundleId starts with "com.google.Chrome.app."
  │  suffix "kjgfgldnnfoeklkmfkjfagphfepbbdan" is in MEET_PWA_APP_IDS
  │  → returns "google-meet"
  ▼
Popup shown: "Meeting detected — Google Meet  [Start recording] ✕"
```

---

### Flow 8 — Feature disabled by user

```
User toggles off "Meeting Detection" in Profile → Notifications → Settings
  │
  ▼
useMeetingDetectionSettings hook writes "xyne-meeting-detection-enabled" = "false" to localStorage
  │  calls window.electronAPI.meetingDetector.setEnabled(false) → IPC to main process
  ▼
ipcMain handler calls meetingDetectorService.stop()
  │  SIGTERM sent to mic-monitor process
  │  if not dead after 3s → SIGKILL
  │  all timers cleared
  ▼
mic-monitor stopped. No more events. No popups.

--- On next app launch ---

NotificationHandler mounts
  │  reads localStorage → "xyne-meeting-detection-enabled" = "false"
  │  calls window.electronAPI.meetingDetector.setEnabled(false)
  ▼
meetingDetectorService.stop() called before any detection runs
```

---

### Flow 9 — mic-monitor process crash / unexpected exit

```
mic-monitor exits with non-zero code (crash, permission denied, etc.)
  │
  ▼
MeetingDetectorService "exit" handler fires
  │  this.stopped = false AND code !== 0 → scheduleRestart()
  ▼
Exponential backoff: 2s, 4s, 8s, 16s, 32s (max 5 attempts)
  │  Each attempt calls this.start() → respawns mic-monitor
  │
  │  If 5 attempts all fail → gives up, logs error
  ▼
On successful restart: binary running again, detection resumes normally
```

---

## Rebuild instructions

After modifying TypeScript files:
```bash
npx tsc --noEmitOnError false
```

After modifying `native/mic-monitor/main.c`:
```bash
npm run build:mic-monitor
```

Both steps run automatically as part of `npm run build`.
