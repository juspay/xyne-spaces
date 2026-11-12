import { AsyncLocalStorage } from "node:async_hooks";
import { serviceAuthHeaders } from "./service-assertion.js";
import { createLogger } from "./logger.js";

const log = createLogger("run-credentials");
let warnedNoKey = false;

/**
 * The current run's session token (issued by claw-auth for this run), so calls
 * to claw-auth made anywhere inside the run can prove which run and user they
 * are for without threading the token through every signature. claw-auth takes
 * the user only from this token; x-user-id is ignored.
 */
const store = new AsyncLocalStorage<{ sessionToken: string }>();

/** Pin the run's session token for the rest of this async flow. */
export function pinRunSessionToken(sessionToken: string): void {
  if (sessionToken) store.enterWith({ sessionToken });
}

/** Run `fn` with `sessionToken` as the current run's token. */
export function withRunSessionToken<T>(sessionToken: string, fn: () => T): T {
  return store.run({ sessionToken }, fn);
}

export function currentRunSessionToken(): string | undefined {
  return store.getStore()?.sessionToken;
}

/**
 * Headers for a call from the runtime to claw-auth: a one-shot service
 * assertion, plus the run's session token when there is one (passed or pinned).
 */
export function clawAuthHeaders(method: string, url: string, sessionToken?: string): Record<string, string> {
  const token = sessionToken ?? currentRunSessionToken();
  try {
    return serviceAuthHeaders(method, url, token ? { sessionToken: token } : {});
  } catch (err) {
    // No signing key: send nothing, so claw-auth refuses the call (fail closed)
    // instead of a fire-and-forget caller crashing the run. Boot refuses to
    // start without the key, so this only happens if it is removed at runtime.
    if (!warnedNoKey) {
      warnedNoKey = true;
      log.error(`[run-credentials] cannot sign calls to claw-auth: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {};
  }
}
