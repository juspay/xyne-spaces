/**
 * A call has one invite URL — `{EXTERNAL_CALL_INVITE_BASE_URL}/call/<externalId>`
 * — so a host can share the same link with teammates and with guests. It points
 * at the external lobby app rather than the Spaces origin, so the ordinary
 * "not our origin, send it to the browser" rules would push a workspace member
 * out of the app and make them walk through the guest lobby just to be
 * redirected back in.
 *
 * Spaces can host the call itself, so main hands these URLs to the renderer
 * instead. The `/external/call/<id>` path shape is ours and nobody else's,
 * which keeps this independent of whichever host the deployment is using.
 */
export function isCallInviteUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    return segments[0] === 'external' && segments[1] === 'call' && Boolean(segments[2]);
  } catch {
    return false;
  }
}
