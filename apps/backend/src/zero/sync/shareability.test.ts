import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_BASE_QUERIES, resolveSharedBase } from './baseQueries';
import { queryMetaFor } from './queryMeta';
import { deriveAclGate, sentinelAclWhereForRole, NON_GUEST_ROLES } from './aclGate';
import { ROW_LEVEL_QUERIES } from './rowLevelQueries';
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
  // Workspace-partitioned BROADCAST: the gateway forces workspaceId from the socket, but the gate/
  // partition analysis is identical either way — partition = workspaceId, ACL (non-guest) = workspaceId = ws.
  getUsersV2: { workspaceId: 'W1' },
  getAllUserGroups: { workspaceId: 'W1' },
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

test('every SHARED_BASE_QUERY ACL is ROLE-INVARIANT across non-guest roles (member gate serves them all)', () => {
  // The gate is derived once under a MEMBER (non-guest) sentinel and served to EVERY non-guest role
  // (member/admin/owner/community — the gateway admits NON_GUEST_ROLES). That is correct ONLY if those
  // roles produce the SAME ACL as MEMBER; a role whose canSelect diverges would be silently
  // under/over-served. Assert equality here so a future admin-specific ACL branch turns the build RED —
  // forcing a deliberate choice (serve that role native, or build a real per-role gate). GUEST is
  // intentionally NOT checked: its ACL DOES differ (stricter), which is exactly why guests are refused.
  for (const name of SHARED_BASE_QUERIES) {
    const meta = queryMetaFor(name, SAMPLE_ARGS[name]);
    assert.ok(meta, `queryMetaFor('${name}') should resolve a partition`);
    assertRoleInvariantAcl(meta!.rootTable, name);
  }
});

/** role × orgRole swept INDEPENDENTLY (dd9dfd719 rider): an ACL branching on ctx.orgRole while
 *  ctx.role stays MEMBER is invisible to a coupled sweep. */
function assertRoleInvariantAcl(table: string, owner: string): void {
  const memberAst = JSON.stringify(sentinelAclWhereForRole(table, 'MEMBER', 'MEMBER') ?? null);
  for (const role of NON_GUEST_ROLES) {
    for (const orgRole of NON_GUEST_ROLES) {
      assert.equal(
        JSON.stringify(sentinelAclWhereForRole(table, role, orgRole) ?? null),
        memberAst,
        `'${owner}' (${table}) ACL differs for role '${role}'/orgRole '${orgRole}' vs MEMBER — the ` +
          `member-derived gate would mis-serve it. Serve it via native Zero or build a per-role gate; ` +
          `do not admit it here.`,
      );
    }
  }
}

test('every ROW-LEVEL query table (root + related) is ROLE-INVARIANT across non-guest roles', () => {
  // The row-level plane serves every non-guest role from ONE workspace instance whose admission is
  // routing (owner == me) — role never re-enters. That is sound only while no served table's ACL
  // branches by role/orgRole (dd9dfd719 rider: these tables were missing from the guard).
  const sampleCtx = { ...syncContext('w-guard'), userID: 'u-guard' } as never;
  for (const [name, spec] of ROW_LEVEL_QUERIES) {
    const ast = (spec.base({ ctx: sampleCtx, args: { workspaceId: 'w-guard' } }) as { ast?: unknown }).ast;
    assert.ok(ast, `'${name}': base AST must resolve for the audit`);
    const tables = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { table?: unknown; related?: unknown[] };
      if (typeof n.table === 'string') tables.add(n.table);
      for (const rel of n.related ?? []) walk((rel as { subquery?: unknown })?.subquery);
    };
    walk(ast);
    assert.ok(tables.size > 0, `'${name}': no tables resolved from the base AST`);
    for (const table of tables) assertRoleInvariantAcl(table, name);
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
