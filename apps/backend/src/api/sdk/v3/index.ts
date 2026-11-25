/**
 * The v3 SDK router: v2's surface for clients that speak transit encryption.
 *
 * Operation ids, direct routes and the Claw product API are v2's. What v3 adds is the
 * client-encryption contract:
 *
 *   - responses are transit-encrypted for the caller's registered key, and the client
 *     decrypts them (the global response encryptor; nothing route-local);
 *   - a mutator with a manifest rule is sent with its rule's fields encrypted, and is
 *     transformed by the encryption service before it runs (see `../mutation.ts` and the
 *     request-body decrypt, which leaves those args as sent);
 *   - GET /encryption-rules       operation id → ruled Zero mutator, so the client can find
 *                                 an operation's rule in its decrypted manifest.
 *
 * v1 and v2 predate this and answer 503 (see `../retired.ts`); @xyne/spaces-sdk 0.3.0 and
 * later call v3.
 */

import type { Router } from 'express';
import { createClawProxyRouter } from '../claw/proxy';
import { createClawRunStreamRouter } from '../claw/run-stream';
import { createClawRunsRouter } from '../claw/runs';
import { createEncryptionRulesRouter } from '../encryption-rules';
import { resolveV3Operation, v3OperationIds } from '../operations';
import { createSdkVersionRouter } from '../v1';

/** The authenticated v3 surface — see `../index.ts`. */
export function createSdkV3Router(): Router {
  return createSdkVersionRouter({
    label: 'v3',
    resolve: resolveV3Operation,
    // As in v2: the typed run stream before the proxy, and `createClawRunsRouter` shadows
    // the shared direct route of the same path.
    routers: [
      createEncryptionRulesRouter(v3OperationIds, resolveV3Operation),
      createClawRunsRouter(),
      createClawRunStreamRouter(),
      createClawProxyRouter(),
    ],
  });
}
