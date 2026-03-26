# Logging Guidelines

## Overview

Unified JSON logging across all Xyne services:

| Service       | Transport           | Batching                  |
|---------------|---------------------|---------------------------|
| **Backend**   | Winston → stdout    | N/A (per-request context) |
| **Dashboard** | Web Worker → HTTP   | Periodic flush + max batch size |
| **Electron**  | electron-log + HTTP | Periodic flush (60s)      |
| **Mobile**    | Console + HTTP      | Periodic flush (60s)      |

All client logs are sent to `POST /godel/events`.

---

## Log Levels

| Level   | Use                                                        |
|---------|------------------------------------------------------------|
| `DEBUG` | Verbose diagnostics (socket state changes, query timings)  |
| `INFO`  | Normal operations (API calls, connections, page loads)      |
| `WARN`  | Recoverable issues (retry attempts, degraded state)        |
| `ERROR` | Failures (unhandled exceptions, request failures)          |

---

## Log Fields

### Backend & Dashboard

| Field | Backend | Dashboard | Description |
|-------|---------|-----------|-------------|
| `level` | ✓ | ✓ | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `timestamp` | ✓ | ✓ | ISO 8601 time of event |
| `event` / `message` | `message` | `event` | Backend uses human-readable `message`; dashboard uses structured `event` codes |
| `emailId` | ✓ | ✓ | User email address |
| `clientSessionId` | ✓ | ✓ | Persistent client session ID |
| `version` | ✓ (`'1.0'`) | ✓ (from package.json) | Application version |
| `zeroClientId` | ✓ | ✓ | Zero Client identifier |
| `zeroClientGroupId` | ✓ | ✓ | Zero Client Group identifier |
| `requestId` | ✓ | — | Unique API request ID |
| `sessionId` | ✓ | — | Server-side session ID (from `x-session-id` header) |
| `platformName` | — | ✓ | Source platform (`web`, `electron`, etc.) |
| `notificationWsId` | — | ✓ | WebSocket ID for notifications |
| `notificationSocketState` | — | ✓ | WebSocket connection state |
| `zeroSocketState` | — | ✓ | Zero socket connection state |
| `pageViewId` | — | ✓ | Current page view ID |
| `pageUrl` | — | ✓ | Current page URL |

### Native Apps (Electron & Mobile)

Electron and mobile share core fields (`level`, `timestamp`, `event`, `emailId`, `clientSessionId`, `platformName`) plus these service-specific fields:

| Field | Electron | Mobile | Description |
|-------|----------|--------|-------------|
| `electronVersion` | ✓ | — | Electron application version |
| `hostname` | ✓ | — | Machine hostname |
| `serialNumber` | ✓ | ✓ | Device serial number |
| `appVersion` | — | ✓ | Mobile application version |
| `brand` | — | ✓ | Device manufacturer brand |
| `model` | — | ✓ | Device model name |
| `systemVersion` | — | ✓ | OS version on device |

---

## Architecture

### Backend (Winston)

- Uses `AsyncLocalStorage` to inject per-request context (`requestId`, `sessionId`, `emailId`, etc.)
- Production format: JSON; Development format: colorized human-readable
- `requestLogger` middleware (`backend/src/middleware/requestLogger.ts`) injects per-request context and logs `REQUEST_START` / `REQUEST_END` events with method, URL, status code, and duration
- File: `backend/src/utils/logger.ts`

### Dashboard (Web Worker)

- Logger runs in a Web Worker to avoid blocking the main thread
- Main thread sends messages (`LOG`, `SET_EMAIL`, `SET_ZERO_CLIENT_ID`, etc.) to the worker
- Worker batches logs and flushes periodically or when batch size is reached
- Config constants (from `dashboard/src/config.ts`): `FLUSH_INTERVAL_IN_MS = 60000`, `MAX_BATCH_SIZE = 10`, `MAX_RETRIES = 3`
- Files: `dashboard/src/utils/logger.ts`, `dashboard/src/utils/logger.worker.ts`

### Electron

- Uses `electron-log` for local file logging + HTTP transport to backend
- Pre-enrollment: sends to unprotected endpoint; post-enrollment: switches to mTLS endpoint
- Separate error log file (`errors.log`) for WARN and ERROR levels
- File: `electron/src/services/logger/Logger.ts`

### Mobile (React Native)

- Similar architecture to Electron: console logging + HTTP transport
- Pre-enrollment: direct fetch; post-enrollment: mTLS via native bridge
- Device ID persisted in MMKV storage
- File: `apps/xyne-spaces/src/services/logger/Logger.ts`

---

## Do's and Don'ts

**Do:**
- Use structured `event` names (snake_case, e.g., `api_call_failed`)
- Include relevant context in `extraFields` (latency, error messages, entity IDs)
- Use appropriate log levels (don't log routine operations as ERROR)
- Pass ad-hoc context via `extraFields: Record<string, unknown>` (all client loggers accept this)
- Flush logs on app close / backgrounding

**Don't:**
- Log sensitive data (passwords, tokens, PII beyond email)
- Log high-cardinality values as top-level fields (use `extraFields` instead)
- Create new Logger instances — use the singleton
- Block the main thread with synchronous logging (dashboard uses Web Worker for this reason)

---

## Console Usage

Not all `console.log` calls should be replaced with the structured logger. The following categories are **legitimate** and should NOT be migrated:

| Category | Files | Reason |
|----------|-------|--------|
| Logger implementation | `logger.ts`, `Logger.ts`, `logger.worker.ts` | Console is the transport or fallback |
| Web Worker context | `logger.worker.ts` | No access to main thread logger |
| React Native bridge | `dashboard/src/utils/reactNativeBridge.ts` | IPC layer; logger unavailable |
| Error boundaries | `ErrorBoundary.tsx` | Last-resort crash logging |
| Pre-logger bootstrap | `electron/src/keychain/` | Runs before Logger is initialized |
| Build/test scripts | `backend/src/workflows/.../test-scripts/`, `remote-client/` | External subprocess context |

The following areas **should use the structured logger** and can be migrated over time:

- Backend controllers, services, repositories (`zeroController.ts`, `pullRequestsRepository.ts`, `zero/server.ts`, etc.)
- Dashboard state machines, providers, components (`roomMachine.ts`, `AuthProvider.tsx`, `NotificationHandler.tsx`, etc.)
- Electron services (`notifications.ts`, `cookies.ts`)
