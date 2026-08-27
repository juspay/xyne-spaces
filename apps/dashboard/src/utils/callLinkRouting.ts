import { callLobbyService } from '../services/Call/callLobbyService';

/**
 * Where a Xyne call invite link should open for the person clicking it.
 *
 * `join-in-place` means the click can be served without leaving the current
 * page: the caller hands the call to `roomActor` and GlobalCallOverlay renders
 * it over whatever screen is open. `navigate` is the escape hatch for the cases
 * that genuinely need a document load — another workspace, or the guest lobby.
 */
export type CallLinkTarget =
  | { kind: 'join-in-place'; callId: string }
  | { kind: 'navigate'; url: string };

/**
 * Decide where a call invite link opens for the current session.
 *
 * One URL serves teammates and guests alike, so the link itself says nothing
 * about who is clicking it. Letting the anchor navigate hands that question to
 * the external lobby app, which probes the session and bounces workspace
 * members back to the dashboard — two full app boots before the call opens.
 * Asking the backend here instead means members never make that trip.
 *
 * `currentWorkspaceId` is the workspace already loaded in this tab; pass
 * `undefined` from trees that have no call overlay to mount into, and the
 * result will always be a navigation.
 */
export async function resolveCallLinkTarget(
  callId: string,
  href: string,
  currentWorkspaceId: string | undefined,
): Promise<CallLinkTarget> {
  try {
    const resolution = await callLobbyService.resolveInternalRoute(callId);
    if (resolution.result !== 'internal') {
      return { kind: 'navigate', url: href };
    }
    if (currentWorkspaceId && resolution.workspaceId === currentWorkspaceId) {
      return { kind: 'join-in-place', callId };
    }
    // Zero, encryption and the workspace cookie are all bootstrapped at load,
    // so entering another workspace still needs a document navigation.
    return {
      kind: 'navigate',
      url: `/${encodeURIComponent(resolution.workspaceId)}/call/${encodeURIComponent(callId)}`,
    };
  } catch {
    // The probe is best-effort. If it cannot answer, the invite link still
    // works — the lobby will make the same decision, just more slowly.
    return { kind: 'navigate', url: href };
  }
}
