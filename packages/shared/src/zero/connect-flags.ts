// Slack Connect — canvas query-mode switch (look canvas children up by canvasId vs connectId).
//
// The VALUE is owned by Superposition CAC (key: `connect_query_enabled_canvas`, default false)
// and can be flipped at runtime with no redeploy. packages/shared cannot import the Superposition
// SDK (backend-only), so this module holds only a runtime-settable cell: the backend resolves the
// CAC boolean and calls `setConnectQueryEnabledCanvas` (see apps/backend/src/zero/server.ts).
//
// Defaults OFF everywhere — including the browser, which never sets it — so the legacy canvasId
// lookup stays in effect until the backend turns it on. The mode is behaviour-neutral in Phase 1
// (connectId and canvasId select the same rows), so an un-synced client optimistic query is safe.
let connectQueryEnabledCanvas = false;

/** Push the current CAC value in (backend, per query request). */
export function setConnectQueryEnabledCanvas(value: boolean): void {
  connectQueryEnabledCanvas = value === true;
}

/** Read the current switch value where a canvas child query is built. */
export function getConnectQueryEnabledCanvas(): boolean {
  return connectQueryEnabledCanvas;
}
