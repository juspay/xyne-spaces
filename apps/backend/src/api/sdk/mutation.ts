/**
 * Writes for /api/sdk.
 *
 * Execution belongs to `runCatalogMutation` in `zero/server.ts`, which is the
 * same code path the app's own mutate fallback takes — one transaction, one ACL
 * wrapper, one drain of Vespa and side-effect jobs.
 *
 * What is decided here is what a failure looks like to a client. The fallback
 * resolves to `{ success: false }` with HTTP 200, which an HTTP caller has no
 * reason to inspect; this throws a typed error so the status code carries the
 * outcome.
 */

import type { AuthData } from '@/zero/mutators';
import { runCatalogMutation } from '@/zero/server';
import { toSdkApiError } from './errors';

/** Run one catalog mutator as the authenticated caller. */
export async function callMutator(
  name: string,
  args: unknown,
  authData: AuthData,
): Promise<void> {
  try {
    await runCatalogMutation(name, args, authData);
  } catch (err) {
    // Domain failures from the mutator catalog are plain `Error`s (~485 throw
    // sites), so this is where they acquire a code and a status.
    throw toSdkApiError(err);
  }
}
