/**
 * Zero Sync Bridge - dormant-by-default WebSocket activity monitor
 *
 * Installation is global (every browser context) but the patch is INACTIVE
 * until `window.__zeroSync.activate()` is called by the test step. While
 * inactive, every patched event takes one cheap `if (active)` branch and
 * nothing else - no timestamp writes, no counter increments, no closure
 * allocation per call. So tests that never call the wait step pay
 * effectively zero ongoing overhead.
 *
 * Lifecycle:
 *   page-load → patch installed, active=false → ~0 overhead per WS event
 *   step calls activate() → active=true → start tracking lastActivity
 *   step polls isSettled() → returns true once 400ms have passed without activity
 *   (no deactivation needed - the next test's fresh context starts inactive again)
 */

export const ZERO_SYNC_BRIDGE_SCRIPT = `
(() => {
  if (typeof window === 'undefined' || window.__zeroSync) return;

  // Single shared state. Plain values on the closure - no objects allocated
  // per event, no Date.now() called when inactive.
  let active = false;
  let lastActivity = 0;

  // Patch WebSocket constructor. While 'active' is false the patched send
  // and event handlers each do exactly one boolean check before returning.
  const OriginalWebSocket = window.WebSocket;
  function PatchedWebSocket(url, protocols) {
    const ws = protocols !== undefined
      ? new OriginalWebSocket(url, protocols)
      : new OriginalWebSocket(url);

    const originalSend = ws.send.bind(ws);
    ws.send = function patchedSend(data) {
      if (active) lastActivity = Date.now();
      return originalSend(data);
    };

    // Only one listener per event; no object allocation, no nested calls.
    ws.addEventListener('message', () => {
      if (active) lastActivity = Date.now();
    });

    return ws;
  }

  PatchedWebSocket.prototype = OriginalWebSocket.prototype;
  PatchedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  PatchedWebSocket.OPEN = OriginalWebSocket.OPEN;
  PatchedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
  PatchedWebSocket.CLOSED = OriginalWebSocket.CLOSED;
  window.WebSocket = PatchedWebSocket;

  // fetch is intentionally NOT patched in the dormant version. We only
  // monitor WebSocket activity - that is sufficient signal for Zero
  // mutations and avoids the overhead of wrapping every fetch call.

  window.__zeroSync = {
    activate: function() {
      active = true;
      lastActivity = Date.now();
    },
    isSettled: function(idleMs) {
      // Not yet activated -> nothing to wait for.
      if (!active) return true;
      return Date.now() - lastActivity >= (idleMs || 400);
    },
  };
})();
`;
