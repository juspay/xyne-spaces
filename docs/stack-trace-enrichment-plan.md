# Stack Trace Enrichment Plan

## Goal

Append runtime error traces containing repository function names and source locations to error logs from `backend`, `dashboard`, and Electron. Do this through each runtime's central logger and global error hooks, without changing every existing logging call.

Target payload:

```ts
interface ErrorTrace {
  errorName: string;
  errorMessage: string;
  errorStack?: string;
  codeFrames: Array<{
    function: string;
    file: string;
    line: number;
    column: number;
  }>;
  fingerprint: string;
  runtime: 'backend' | 'dashboard' | 'electron-main' | 'dashboard-in-electron';
}
```

Keep existing log fields unchanged. Add trace fields only to error-level logs.

## Constraints

- Preserve raw stack before processing. It permits later re-symbolication when source-map logic changes.
- Resolve source maps before filtering frames.
- Keep only workspace-owned frames: `backend/src`, `dashboard/src`, `electron/src`, and explicit shared workspace roots.
- Drop Node, Electron, Vite, React, and `node_modules` frames from `codeFrames`; do not delete them from raw `errorStack`.
- Redact potentially sensitive error metadata such as request/response/config/headers.
- Limit cause depth, frame count, and serialized bytes.
- Do not expect a JavaScript stack to cross `await`, timers, event emitters, queues, IPC, or process boundaries. Async ancestry needs separate context propagation.

## 1. Shared Trace Contract

Create a small per-runtime trace utility with same contract. Shared package extraction can follow after all three implementations prove shape stable.

Utility responsibilities:

1. Accept `Error`, non-Error rejection reasons, or logger arguments.
2. Retain original error stack when present.
3. For `console.error('message')` without an `Error`, capture `new Error().stack` and remove utility/logger frames.
4. Serialize `Error.cause` recursively with depth limit.
5. Parse source-mapped stack frames into `codeFrames`.
6. Filter to source roots owned by this repository.
7. Generate a fingerprint from error name, normalized message, and first three to five filtered function/file frames.

Fingerprint normalization should remove release-specific line/column values. Keep line/column in `codeFrames` for debugging.

## 2. Backend

### Central logger

Modify `backend/src/utils/logger.ts`.

- Add trace normalization in a Winston format before JSON rendering.
- Inspect message, metadata, and Winston splat arguments. Existing patterns include both `logger.error('message', error)` and `logger.error('message', { error })`.
- Replace Error instances with safe serialized error data plus `errorTrace`.
- Reuse existing `loggerContext` fields in every enriched error log.
- Avoid emitting trace fields for non-error log levels.

This applies to existing logger calls globally; no bulk call-site rewrite.

### Runtime source maps

`backend/tsconfig.json` already emits source maps. Enable Node runtime lookup for production entry points:

- `node --enable-source-maps dist/index.js`
- worker entry point must use same setting.

Decide whether command scripts or deployment `NODE_OPTIONS=--enable-source-maps` owns setting. Use one method consistently.

### Error boundaries

Update these global paths to use normalizer:

- `backend/src/index.ts`: `unhandledRejection`, `uncaughtException`.
- `backend/src/worker.ts`: worker startup/global failure handling.
- `backend/src/middleware/errorHandler.ts`: retain original thrown error stack as primary stack. Current `AppError` construction creates replacement stack; preserve original error trace and record wrapper stack separately if needed.

### Async context

`backend/src/utils/logger.ts` already exposes `AsyncLocalStorage` as `loggerContext`, and `middleware/requestLogger.ts` creates HTTP context.

- Extend context later with operation name and trace ID.
- Add context at HTTP, queue consumer, WebSocket, scheduled worker, and external callback boundaries.
- Keep this separate from initial stack-frame work.

## 3. Dashboard

### Central logger and global browser hooks

Modify `dashboard/src/utils/logger.ts`, `dashboard/src/main.tsx`, and `dashboard/src/utils/errorReportLogCollector.ts`.

- Add trace extraction inside `Logger.error`, so existing structured frontend error logs gain `errorTrace` without call-site edits.
- Preserve current global interception of `console.error`, `window.error`, and `unhandledrejection`.
- Pass raw error objects, not only `String(error)`, into trace normalizer.
- Add short-lived fingerprint deduplication. Current `console.error` interception plus explicit `logger.error` can send same error twice.
- Store normalized trace in error-report log entries, while keeping current text report format compatible.

### React errors

Modify `dashboard/src/components/ErrorBoundary/ErrorBoundary.tsx`.

- Send JavaScript stack through common normalizer.
- Keep `errorInfo.componentStack` separately as React component ancestry.
- Do not merge React component stack with JavaScript call stack; they answer different questions.

### Production source maps

`dashboard/vite.config.ts` currently does not enable production source maps.

- Build hidden source maps with `build.sourcemap: 'hidden'`.
- Upload maps during release keyed by dashboard app version/build hash.
- Symbolicate server-side in logging pipeline or AI-ingestion pipeline.
- Do not expose maps publicly unless product security policy allows source disclosure.
- Include release/build identifier in every frontend error payload.

Browser `Error.stack` alone cannot reliably map minified production functions to TypeScript function names. Source-map upload and controlled symbolication are required.

## 4. Electron Main Process

### Structured logger

Modify `electron/src/services/logger/Logger.ts`.

- Enrich logs inside `LoggerService.addLog`.
- Enrich `Logger.logError` from original Error before string conversion.
- Apply only at error level.

### Direct electron-log calls

Electron main code also calls `log.error(...)` directly.

- Install one `electron-log` hook at startup, before application initialization.
- Extract Error arguments and append normalized trace to hook message data or structured log payload.
- Keep native file log output and remote `Logger` output consistent where feasible.

### Global process paths

Update `electron/src/services/error-handler.ts`.

- Reuse normalizer in `uncaughtException` and `unhandledRejection`.
- Keep renderer crash, child-process-gone, and unresponsive events as lifecycle errors; these may have no JavaScript stack.
- Tag every event by runtime and origin.

### Runtime source maps

`electron/tsconfig.json` already emits source maps and inline source content.

- Enable Node source-map resolution before importing application code.
- Verify packaged application retains `.map` files required for source mapping, or upload Electron maps per application release and symbolicate remotely.

## 5. Cross-Process Correlation

Stack frames stop at Electron renderer/main IPC and browser/backend HTTP calls.

Add correlation fields gradually:

- Dashboard: client session ID, page view ID, app version, operation ID.
- Electron: client session ID, process/window ID, IPC operation ID.
- Backend: request ID, client session ID, operation ID.

Propagate operation ID in HTTP headers and approved IPC payloads. Do not place user content, tokens, headers, or secrets in trace context.

## 6. OpenTelemetry Follow-Up

Current telemetry state:

- Backend has optional OpenTelemetry trace exporter in `backend/src/services/otel/telemetry.ts`, but broad instrumentation is not configured.
- Dashboard and Electron telemetry initialize metrics only.

After base stack enrichment works:

1. Create spans for dashboard user actions, API requests, Electron IPC handlers, backend routes, workers, and queues.
2. Propagate W3C trace context across HTTP and safe IPC boundaries.
3. Add trace ID and span ID to enriched error logs.
4. Use span ancestry for async/cross-process operation chains.

Do not use OpenTelemetry as blocker for initial stack trace logging.

## 7. Verification

Add targeted tests for each runtime.

### Backend

- Error from `node_modules` wrapped by app code resolves to `backend/src` frames only.
- `logger.error('message', error)` and `logger.error('message', { error })` both enrich.
- `Error.cause` chain serializes safely.
- Express handler preserves original stack.
- Non-Error rejection does not throw inside global handler.

### Dashboard

- `console.error(new Error(...))` captures source trace.
- string-only `console.error` captures caller stack.
- `window.error`, unhandled rejection, and React ErrorBoundary all enrich.
- duplicate global and explicit logger reports collapse within dedup window.
- hidden source map symbolication resolves release artifact to `dashboard/src` functions.

### Electron

- `Logger.logError` enriches remote and file logs.
- direct `log.error` hook enriches main-process errors.
- main-process uncaught rejection includes source-mapped `electron/src` frames.
- packaged build retains or remotely uploads matching source maps.

### Security and size

- Error payloads never include Axios config/request/response/headers.
- Frame and cause limits cap payload size.
- Fingerprint stays stable across line-only release changes.

## Delivery Order

1. Define trace fields, parser/filter, redaction, fingerprint behavior.
2. Implement backend central enrichment and source-map runtime support.
3. Implement Electron central enrichment and `electron-log` hook.
4. Implement dashboard central enrichment and global-hook deduplication.
5. Add hidden dashboard source maps and release artifact symbolication.
6. Add tests and release verification across development and packaged/production builds.
7. Add operation context and OpenTelemetry propagation for async/cross-process ancestry.
