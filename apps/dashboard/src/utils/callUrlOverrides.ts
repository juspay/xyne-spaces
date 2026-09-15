import { authActor } from '../machines/authMachine';
import { queryClient } from '../services/clients/queryClient';
import {
  CALL_AUTO_JOIN_CAC_KEY,
  DEFAULT_CALL_AUTO_JOIN_CAC_CONFIG,
  isCallAutoJoinAllowed,
  type CallAutoJoinCacConfig,
} from '../hooks/callAutoJoinCacConfig';

/**
 * The call URL API's query-parameter names. Exported because this is a public
 * contract — anything constructing these URLs (deep links, an unattended room
 * station's launcher) should reference these rather than re-spelling them, since
 * a typo here fails silently: the param is simply ignored.
 */
export const CALL_URL_PARAMS = {
  autoJoin: 'autoJoin',
  mic: 'mic',
  camera: 'camera',
  telepresence: 'telepresence',
} as const;

/** Value that turns on the flag-style params. */
const FLAG_ON = '1';

/**
 * What a call URL asked for, beyond which call to join.
 *
 * Carried as one object rather than a field per setting: these only ever travel
 * together, they are set in exactly one place, and roomMachine treats them as a
 * single unit — so a single nullable field says "this call was driven by a URL,
 * and here is what it asked for" without four separate context entries to keep
 * in sync across two events and clearContext.
 *
 * `null` is meaningful: it marks a join the user drove themselves, which is what
 * suppresses the URL-driven behaviour (silent retry, no failure toast).
 */
export interface CallUrlOverrides {
  /** Initial mic state, overriding the saved join preference. */
  mic?: boolean;
  /** Initial camera state, likewise. */
  camera?: boolean;
  /** Start the call already in presentation (telepresence) mode. */
  presentation?: boolean;
}

/** `on`/`off` -> boolean; anything else (including absent) -> undefined = "not requested". */
const parseOnOff = (value: string | null): boolean | undefined =>
  value === 'on' ? true : value === 'off' ? false : undefined;

/** Whether the URL asked for an auto-join at all. Every other param rides on this. */
export const isAutoJoinRequested = (searchParams: URLSearchParams): boolean =>
  searchParams.get(CALL_URL_PARAMS.autoJoin) === FLAG_ON;

/**
 * The overrides a URL is asking for. Always returns an object — an auto-join that
 * names no media params still marks the call as URL-driven, which is the part
 * roomMachine needs in order to retry silently.
 */
export const parseCallUrlOverrides = (searchParams: URLSearchParams): CallUrlOverrides => {
  const mic = parseOnOff(searchParams.get(CALL_URL_PARAMS.mic));
  const camera = parseOnOff(searchParams.get(CALL_URL_PARAMS.camera));
  const presentation = searchParams.get(CALL_URL_PARAMS.telepresence) === FLAG_ON;

  return {
    ...(mic !== undefined && { mic }),
    ...(camera !== undefined && { camera }),
    ...(presentation && { presentation: true }),
  };
};

/**
 * The same CAC gate useCallAutoJoin applies, re-evaluated without React.
 *
 * roomMachine calls this immediately before acting on an override, so the flag is
 * checked next to the effect rather than only at the point the URL was read. The
 * hook still gates entry; this exists so the machine does not have to trust that
 * whoever sent the event did the check — any future caller setting
 * `callUrlOverrides` gets the same enforcement for free.
 *
 * Reads the cache rather than fetching: `useCacConfig` populates
 * ['cac-config', key] on the same queryClient singleton the app's provider uses,
 * and by the time a call is connecting the auto-join hook has already requested
 * it. A cache miss falls back to the disabled default, matching the hook's
 * fail-closed behaviour.
 */
export function isCallUrlApiAllowed(): boolean {
  const cached = queryClient.getQueryData<{ config?: CallAutoJoinCacConfig | null }>([
    'cac-config',
    CALL_AUTO_JOIN_CAC_KEY,
  ]);

  return isCallAutoJoinAllowed(
    cached?.config ?? DEFAULT_CALL_AUTO_JOIN_CAC_CONFIG,
    authActor.getSnapshot().context.user?.email,
  );
}
