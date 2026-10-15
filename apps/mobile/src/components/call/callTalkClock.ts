/**
 * When the conversation actually started (the first other person was present), kept outside
 * React so it survives minimising the call screen and coming back through the ongoing-call
 * banner — both of which unmount / remount the screen — and so the banner and the screen agree.
 *
 * Only the current call is remembered. `sessionStartMs` is when *this device* joined the room:
 * a start recorded before it belongs to an earlier stay in the same call (leave and rejoin) and
 * is ignored, so rejoining restarts the clock.
 */

let current: { callId: string; startMs: number } | null = null;

export function getCallTalkStart(
  callId: string | null | undefined,
  sessionStartMs = 0,
): number | null {
  if (!callId || !current || current.callId !== callId) return null;
  return current.startMs >= sessionStartMs ? current.startMs : null;
}

/** Records the start once per stay; later calls keep the original time. */
export function markCallTalkStart(
  callId: string,
  sessionStartMs = 0,
  startMs: number = Date.now(),
): number {
  const existing = getCallTalkStart(callId, sessionStartMs);
  if (existing !== null) return existing;
  current = { callId, startMs };
  return startMs;
}
