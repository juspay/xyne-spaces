import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_BASE_QUERIES, resolveSharedBase } from './baseQueries';
import { queryMetaFor } from './queryMeta';
import { deriveAclGate } from './aclGate';
import { syncContext } from './serviceIdentity';

/**
 * SHAREABILITY CONTRACT enforcement (build-time gate). The shared sync engine admits a query ONLY if
 * its ACL collapses to a GATE (one boolean per (user, instance), constant across rows) AND it has no
 * per-subscriber cursor pagination. This test is the mechanical gate: onboarding a per-row or cursor
 * query to SHARED_BASE_QUERIES turns the build RED here, before it can leak / half-work in prod.
 *
 * Each allowlisted query needs representative args (≥ the partition column) so we can derive its
 * partition + base AST. Adding a query to the allowlist without SAMPLE_ARGS also fails, by design.
 */
const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  channelLatestMultipleConversationsV4: { channelId: 'C1', isMember: true, limit: 25 },
};

test('every SHARED_BASE_QUERY is GATE-collapsible (no per-row admission)', () => {
  for (const name of SHARED_BASE_QUERIES) {
    const args = SAMPLE_ARGS[name];
    assert.ok(args, `add SAMPLE_ARGS['${name}'] so the shareability gate can check it`);
    const meta = queryMetaFor(name, args);
    assert.ok(meta, `queryMetaFor('${name}') should resolve a partition`);
    const gate = deriveAclGate(meta!.rootTable);
    const c = gate.collapsibility(meta!.partitionColumn);
    assert.ok(
      c.ok,
      `'${name}' is NOT gate-collapsible → it must NOT be in SHARED_BASE_QUERIES (serve it via native Zero). ${c.reason ?? ''}`,
    );
  }
});

test('no SHARED_BASE_QUERY uses per-subscriber cursor pagination', () => {
  // A fixed `.limit()` window is fine (shared by the instance); a `.start()`/cursor is per-subscriber
  // scroll → fragments into per-subscriber instances → not shareable. Detect a cursor on the base AST.
  // NOTE: this build-time check only sees the cursor if SAMPLE_ARGS carries a cursor — for a query
  // with a CONDITIONAL `.start()` (`if (args.cursor) …`), SAMPLE_ARGS MUST include cursor-shaped args
  // or this stays green. The load-bearing catch is the runtime refuse in clientGateway (builds the
  // base from the client's ACTUAL args); this test is the fast-feedback belt.
  for (const name of SHARED_BASE_QUERIES) {
    const args = SAMPLE_ARGS[name];
    assert.ok(args, `add SAMPLE_ARGS['${name}']`);
    const base = resolveSharedBase(name, syncContext(), args) as { ast?: { start?: unknown } } | undefined;
    assert.ok(base, `resolveSharedBase('${name}') should build`);
    assert.equal(
      base!.ast?.start,
      undefined,
      `'${name}' has a cursor (.start) → per-subscriber pagination is not shareable`,
    );
  }
});
