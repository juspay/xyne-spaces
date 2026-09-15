// Read-only queries from apps/backend/src/zero/queries.ts, chosen because they are the
// reads the chat and ticket surfaces perform constantly and because they are the shape
// apps/backend/docs/guidelines/zero/queries.md warns about: several `.related()` joins,
// and list reads with no natural bound.
//
// Pure data and pure functions only — no k6 globals — so the k6 scenario and the Node
// test suite can both import it.
//
// WIRE FORMAT — verified against @rocicorp/zero 1.9.0, not inferred from the public docs
// (which describe only the inner array):
//
//   zero-protocol/src/custom-queries.js
//     transformRequestMessageSchema = tuple([literal('transform'), transformRequestBodySchema])
//     transformRequestBodySchema    = array({ id, name, args: readonly(array(json)) })
//
//   zero-server/src/queries/process-queries.js
//     parsed = parse(body, transformRequestMessageSchema); parsed[1].map(...)
//     wrapQueryRequestHandler = (name, args) => handler(name, args[0])
//
// So the request is `['transform', [{id, name, args:[argsObject]}]]`: the batch is wrapped
// in a tagged tuple, and each query's arguments are array-wrapped because the server reads
// `args[0]` before handing them to the query's zod schema.

export const ZERO_QUERY_CATALOG = Object.freeze([
  // The heaviest read on the chat path: two related sets, one with a nested filter.
  Object.freeze({
    name: 'conversationMessagesV2',
    requires: Object.freeze(['conversationId']),
    args: (user) => ({ conversationId: user.conversationId }),
  }),
  // A point read, to show per-row latency separately from list latency.
  Object.freeze({
    name: 'getConversationById',
    requires: Object.freeze(['conversationId']),
    args: (user) => ({ conversationId: user.conversationId }),
  }),
  // An unbounded list read with three related sets.
  Object.freeze({
    name: 'allTickets',
    requires: Object.freeze([]),
    args: () => ({}),
  }),
  // Included only when the fixture supplies a channel, since not every test identity has one.
  Object.freeze({
    name: 'channelConversationsV2',
    requires: Object.freeze(['channelId']),
    args: (user) => ({ channelId: user.channelId, isMember: true }),
  }),
]);

export function selectQueries(user) {
  return ZERO_QUERY_CATALOG.filter(({ requires }) =>
    requires.every((field) => typeof user[field] === 'string' && user[field] !== ''),
  );
}

/** The full request body for POST /api/zero/query. */
export function buildTransformMessage(descriptors, user) {
  return [
    'transform',
    descriptors.map((descriptor, index) => ({
      id: `${descriptor.name}-${index}`,
      name: descriptor.name,
      args: [descriptor.args(user)],
    })),
  ];
}

/**
 * The per-query entries of a successful response.
 *
 * `handleQueryRequest` resolves to `{kind: 'QueryResponse', queries: [...]}`, and the
 * backend returns it with a bare `res.json(result)`.
 */
export function transformEntries(body) {
  return Array.isArray(body?.queries) ? body.queries : undefined;
}

/**
 * Whether the endpoint rejected the batch.
 *
 * A parse or internal failure resolves to `{kind: 'TransformFailed', ...}` and is still
 * served as **HTTP 200**, so status alone cannot be trusted as a success signal.
 */
export function isTransformFailure(body) {
  return body?.kind === 'TransformFailed';
}
