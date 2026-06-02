/**
 * Shared notice copy for "I just submitted a request that needs admin
 * approval" UX surfaces.
 *
 * Used by:
 *   - Agent push-to-global / push-to-spaces (AgentList, AgentDetailPageV2,
 *     AgentDetailPageV3)
 *   - Skill request (DashboardPage, SkillsPageV2)
 *   - MCP server publish request (ConnectionList)
 *
 * Why centralized: previously each site rolled its own UX — some swallowed
 * errors silently to console, some used alert(), V3 uses a snackbar. Users
 * were left guessing whether a request actually landed and where to follow
 * up. One canonical sentence keeps the answer consistent.
 *
 * V1/V2 call `alertAdminRequestForwarded()`; V3's snackbar callers pass
 * `ADMIN_REQUEST_FORWARDED_MESSAGE` as the description so the wording
 * matches across all surfaces.
 */

export const ADMIN_REQUEST_FORWARDED_MESSAGE =
  "Your request has been forwarded to the Xyne Spaces Admin. " +
  "ACL changes are required to push this through. " +
  "For a faster response, please ping the team in #testing-claw.";

/** Show the standard "request forwarded" notice. Used after a request
 *  endpoint returns successfully. */
export function alertAdminRequestForwarded(): void {
  alert(ADMIN_REQUEST_FORWARDED_MESSAGE);
}

/** Show a failure alert with the actual error message so users see WHY
 *  it failed instead of the request silently disappearing into the
 *  browser console. */
export function alertAdminRequestError(err: unknown, fallback = "Failed to submit request"): void {
  const msg = err instanceof Error ? err.message : String(err);
  alert(msg || fallback);
}

/** Async wrapper that does the request → on success show the forwarded
 *  notice, on failure show the error. Returns the result on success or
 *  `undefined` if the call threw. Most call sites should use this. */
export async function withAdminRequestAlert<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await fn();
    alertAdminRequestForwarded();
    return result;
  } catch (err) {
    console.error("[admin-request]", err);
    alertAdminRequestError(err);
    return undefined;
  }
}
