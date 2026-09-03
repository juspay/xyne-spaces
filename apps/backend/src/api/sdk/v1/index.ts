/**
 * The v1 SDK router.
 *
 * A client posts an operation id and its arguments; this resolves the id through
 * `mapper.ts`, shapes the arguments through `parser.ts`, and runs the result on
 * the same code path the app's own query/mutate fallback takes.
 *
 * What a caller never sends, and never sees, is the name of the Zero operation
 * behind its request. That is the difference between this and the unversioned
 * `/api/sdk/catalog/*` surface it replaces: there, the client named the catalog
 * operation, so every catalog rename was a breaking change for every installed
 * copy of the SDK.
 *
 * The endpoint has to agree with the operation's kind. Posting a mutator to
 * `/query` is a 400 rather than a silent read, because the two endpoints are not
 * interchangeable server-side — reads go to the replica pool and writes open a
 * transaction.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { handle } from '../handler';
import { callQuery } from '../query';
import { callMutator } from '../mutation';
import { createDirectRouter } from '../direct';
import { SdkApiError } from '../errors';
import { resolveV1Operation } from './mapper';
import { parseV1Args } from './parser';
import type { V1Kind } from './types';

/**
 * Body of a v1 call.
 *
 * `op` is an SDK operation id such as `projects.update` — the same string the
 * published package uses in its resource methods.
 */
const v1Request = z.object({
  op: z.string().min(1),
  args: z.unknown().optional(),
});

function v1Handler(endpoint: Extract<V1Kind, 'query' | 'mutator'>) {
  return handle(async (req: Request, res: Response) => {
    const auth = req.sdkAuth;
    if (!auth) throw new SdkApiError('unauthenticated', 'Missing authenticated principal.');

    const { op, args } = v1Request.parse(req.body);

    const target = resolveV1Operation(op);
    if (!target) {
      throw new SdkApiError('not_found', `Unknown operation "${op}" in API v1.`);
    }
    if (target.kind !== endpoint) {
      // Naming the right endpoint rather than just refusing: this is a client
      // bug, and the fix is mechanical.
      throw new SdkApiError(
        'validation_failed',
        `Operation "${op}" is a ${target.kind}; send it to /api/sdk/v1/${
          target.kind === 'mutator' ? 'mutate' : target.kind
        }.`,
      );
    }

    const parsed = parseV1Args(op, args);

    if (endpoint === 'query') {
      res.status(200).json({ data: await callQuery(target.name, parsed.args, auth.ctx) });
      return;
    }

    await callMutator(target.name, parsed.args, auth.authData);
    // `generated` carries any id this layer minted, so a caller that just created
    // a row learns its id without having had to supply one.
    res.status(200).json({ success: true, ...(parsed.generated ? { generated: parsed.generated } : {}) });
  });
}

/**
 * The authenticated v1 surface. Mounted behind the same API-key middleware as
 * every other `/api/sdk` route — see `app.ts`.
 */
export function createSdkV1Router(): Router {
  const router = Router();

  router.post('/query', v1Handler('query'));
  router.post('/mutate', v1Handler('mutator'));

  // Direct controller routes, reachable under their versioned paths. These still
  // carry their own path in the client, which is the remaining half of the
  // migration — catalog operations move first because they are the ones whose
  // names were leaking.
  router.use(createDirectRouter());

  return router;
}

export { V1_MAPPER, v1OperationIds, resolveV1Operation } from './mapper';
export { V1_PARSERS, parseV1Args } from './parser';
export type { V1Kind, V1Target, V1Parsed, V1Parser } from './types';
