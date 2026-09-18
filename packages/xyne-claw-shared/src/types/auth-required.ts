/**
 * The "this run is blocked on a credential" signal.
 *
 * Shared because three processes handle the same shape: claw-auth produces it,
 * xyne-claw carries it out of the run, and claw-auth consumes it again to post
 * a card and re-dispatch on grant.
 *
 * Structured rather than prose in the tool result because prose does not work:
 * a model optimising for "finish the task" retries, proxies and shells out past
 * any sentence telling it to stop. The signal leaves the model's control — it
 * ends the run, and claw-auth decides what the user sees.
 */

export type AuthRequiredReason =
  /** A connector exists for this host; this user has not connected it. */
  | "not_connected"
  /** A credential was attached and refused, and going without it failed too —
   *  a genuine permission gap, not our interference. */
  | "rejected"
  /** Nothing exists for this host: the user supplies a credential once and we
   *  bind it. The generic path for internal services. */
  | "unknown_host";

/**
 * How the blocker was noticed. The two are not equally trustworthy: a status
 * code is unambiguous, while the agent declaring a login wall is a judgement
 * call that a hostile page could steer. An agent-reported blocker can only ever
 * ASK the user, never act.
 */
export type AuthRequiredSource =
  /** Server-side, from a 401/403 on the actual response. */
  | "status"
  /** The agent called `request-access` — covers login walls that return 200,
   *  SSO redirects, and anything else a status code cannot express. */
  | "agent";

export interface AuthRequiredDetail {
  /** `McpServer.type`, e.g. "github" or "webfetch-host:api.example.com". */
  serverType: string;
  /** Human label for the card, e.g. "GitHub". */
  providerLabel: string;
  reason: AuthRequiredReason;
  /** Host that triggered it — shown to the user, and the dedupe key with serverType. */
  host: string;
  /** The URL the run was blocked on, so the resumed run knows where to pick up. */
  url: string;
  source: AuthRequiredSource;
  /** Agent-supplied, for the card body. Untrusted text — render, never execute. */
  reason_text?: string;
}

/** Marker used on a run's terminal error so claw-auth can classify it. */
export const AUTH_REQUIRED_ERROR_PREFIX = "auth_required:";

export function authRequiredError(serverType: string): string {
  return `${AUTH_REQUIRED_ERROR_PREFIX}${serverType}`;
}

export function isAuthRequiredError(error?: string | null): boolean {
  return typeof error === "string" && error.startsWith(AUTH_REQUIRED_ERROR_PREFIX);
}

/** What the model is told when a fetch is blocked. Deliberately a hard stop:
 *  the card and the resume happen outside the model. */
export function authRequiredToolMessage(detail: AuthRequiredDetail): string {
  const lead =
    detail.reason === "not_connected"
      ? `${detail.providerLabel} is not connected, so ${detail.host} refused this request.`
      : detail.reason === "unknown_host"
        ? `${detail.host} needs credentials and nothing is configured for it yet.`
        : `Your ${detail.providerLabel} connection was refused by ${detail.host}, and going without it failed too.`;
  return (
    `STOP — ${lead}\n\n` +
    `An access request for ${detail.providerLabel} has been posted to the user. Do NOT continue working. ` +
    `Do NOT call any more tools. Do NOT retry this URL, route it through a proxy, or try a container or browser — ` +
    `every other path hits the same wall. Simply tell the user you need ${detail.providerLabel} access and stop. ` +
    `A new run will start automatically the moment they connect it.`
  );
}
