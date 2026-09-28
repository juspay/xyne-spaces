// Write load for POST /api/zero/push — the mutation path behind the chat send action.
//
// WIRE FORMAT — verified against @rocicorp/zero 1.9.0 source, not inferred. Zero does not
// publish this contract; its docs say to read `handleMutateRequest`. The relevant files:
//
//   zero-protocol/src/mutate-server.js
//     mutateParamsSchema = object({ schema: string, appID: string })   ← QUERYSTRING, not body
//   zero-server/src/process-mutations.js
//     jsonBody = await request.json(); parse(jsonBody, pushBodySchema)
//     parse(Object.fromEntries(new URL(request.url).searchParams), mutateParamsSchema)
//   zero-protocol/src/push.js
//     pushBodySchema = object({ clientGroupID, mutations, pushVersion, schemaVersion?,
//                               timestamp, requestID, auth?, traceparent? })
//   zero-protocol/src/mutation.js
//     customMutationSchema = object({ type: 'custom', id: number, clientID: string,
//                                     name: string, args: array(json), timestamp: number })
//   zql/src/mutate/mutator-registry.js
//     getMutator = getValueAtPath(registry, name, '.')   ← dot-separated mutator path
//   replicache/src/sync/push.js
//     assert(pushVersion === 1)
//
// SEQUENCING: mutation ids must increase monotonically per clientID. The server answers
// `oooMutation` for a gap and `alreadyProcessed` for a replay, so every virtual user gets
// its own clientID and its own counter. Sharing either across VUs would measure Zero's
// deduplication rather than the mutation path.
//
// Pure data and functions only — no k6 globals — so the k6 scenario and the Node test
// suite can both import it.

export const PUSH_VERSION = 1;
export const MUTATOR_NAME = 'messages.send';

/**
 * A stable, per-virtual-user client identity.
 *
 * Derived from run id and VU number rather than random, so the same VU keeps the same
 * clientID across iterations and its mutation ids stay a single ordered sequence.
 */
export function buildClientIdentity(runId, vuNumber) {
  return {
    clientID: `perf-${runId}-vu${vuNumber}`,
    clientGroupID: `perf-${runId}-group${vuNumber}`,
  };
}

export function buildMutatePath({ schema, appID } = {}) {
  if (typeof schema !== 'string' || schema === '') {
    throw new Error('PERF_ZERO_SCHEMA is required: the push endpoint parses a schema parameter');
  }
  if (typeof appID !== 'string' || appID === '') {
    throw new Error('PERF_ZERO_APP_ID is required: the push endpoint parses an appID parameter');
  }
  return `/api/zero/push?schema=${encodeURIComponent(schema)}&appID=${encodeURIComponent(appID)}`;
}

export function buildPushBody({
  clientGroupID,
  clientID,
  mutationId,
  timestamp,
  requestID,
  args,
}) {
  if (!Number.isInteger(mutationId) || mutationId < 1) {
    throw new Error('Mutation id must be a positive integer, or the server reports oooMutation');
  }

  return {
    clientGroupID,
    pushVersion: PUSH_VERSION,
    timestamp,
    requestID,
    mutations: [
      {
        type: 'custom',
        id: mutationId,
        clientID,
        name: MUTATOR_NAME,
        args: [args],
        timestamp,
      },
    ],
  };
}

/** Per-mutation results of a successful push. */
export function mutationResults(body) {
  return body?.kind === 'MutateResponse' && Array.isArray(body.mutations)
    ? body.mutations
    : undefined;
}

/**
 * Whether the endpoint rejected the batch outright.
 *
 * A parse, database or version failure answers `{kind: 'PushFailed', ...}`, and the backend
 * serves it with a bare res.json — so HTTP status alone cannot be trusted.
 */
export function isPushFailure(body) {
  return body?.kind === 'PushFailed';
}

/** The error code of one mutation result, or undefined when it succeeded. */
export function mutationError(entry) {
  return entry?.result?.error;
}
