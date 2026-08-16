/**
 * Ask AI stream core — platform-agnostic barrel.
 *
 * The shared, transport-free heart of the "Ask AI" streaming chat, consumed by
 * BOTH the dashboard (web) and the native mobile app. Import it via the
 * dedicated subpath, e.g. `import { buildAskAIRequestBody } from '@xyne/shared/askAI'`.
 *
 * What lives here (pure, no fetch / no globals / no React):
 *  - types.ts       — request input, SSE + live event unions, transport/store seams
 *  - requestBody.ts — camelCase input -> snake_case wire body
 *  - sse.ts         — incremental SSE frame parser
 *
 * What stays per-platform (behind the seams): the actual streaming transport
 * (web worker+fetch+cookies vs native mTLS+Bearer), persistence (IndexedDB vs
 * MMKV/SQLite), rAF/UI batching, and applying events to platform message state.
 */

export * from "./types";
export * from "./requestBody";
export * from "./sse";
