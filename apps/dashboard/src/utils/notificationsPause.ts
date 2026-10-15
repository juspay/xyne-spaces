/**
 * Whether "Pause notifications" is on: a pause was set and has not run out.
 * The one definition for every surface that honours it — Settings, the profile
 * menu and the incoming-call ringer — so they cannot drift apart.
 */
export function notificationsArePaused(
  pausedUntil: number | null | undefined,
  now: number = Date.now(),
): boolean {
  return !!pausedUntil && pausedUntil > now;
}
