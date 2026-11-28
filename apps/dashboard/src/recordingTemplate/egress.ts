/**
 * The contract between LiveKit egress and a custom recording template: egress opens the page
 * with `url`, `token` and `layout` query parameters, starts recording when the page logs
 * START_RECORDING and stops when it logs END_RECORDING (it also stops on its own when the
 * egress is stopped). Same as @livekit/egress-sdk's EgressHelper.
 */
export interface EgressParams {
  /** LiveKit server URL, as egress reaches it. */
  url: string;
  /** Egress's own access token: hidden, subscribe-only, with the `recorder` grant. */
  token: string;
  /** The layout the backend asked for: 'speaker-dark' or 'grid-dark'. */
  layout: string;
}

export function readEgressParams(search: string = window.location.search): EgressParams | null {
  const params = new URLSearchParams(search);
  const url = params.get('url');
  const token = params.get('token');
  if (!url || !token) return null;
  return { url, token, layout: params.get('layout') || 'grid-dark' };
}

let started = false;

/** Tell egress to start recording. Once only. */
export function startRecording(): void {
  if (started) {
    return;
  }
  started = true;
  // eslint-disable-next-line no-console -- egress listens for this exact console message
  console.log('START_RECORDING');
}

/** Tell egress the recording is over (the call ended). */
export function endRecording(): void {
  // eslint-disable-next-line no-console -- egress listens for this exact console message
  console.log('END_RECORDING');
}
