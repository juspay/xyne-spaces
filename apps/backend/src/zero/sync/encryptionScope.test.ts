/**
 * Encryption-scope tripwire (node:test, env-free).
 *
 * Emit-time decryption is wired on the GATE plane only (fanout #hydrate snapshot/resume +
 * #dispatch — see rowDecrypt.ts). The ROW-LEVEL plane (#hydrateRowLevel / #tryResumeRowLevel /
 * #dispatchRowLevel) has no decrypt sites, deliberately: no row-level query serves encrypted
 * content today. This test makes that assumption structural — onboarding a row-level query
 * whose table (root or related) carries encrypted fields fails CI here until row-level
 * decrypt is actually implemented, instead of silently shipping ciphertext to clients.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACE_PARTITIONED_REGISTRY, encryptedFieldsConfig } from '@xyne/shared';

const SAMPLE_ARGS = { workspaceId: 'ws-tripwire' };

function tablesOfAst(ast: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { table?: unknown; related?: unknown[] };
    if (typeof n.table === 'string') found.add(n.table);
    for (const rel of n.related ?? []) walk((rel as { subquery?: unknown })?.subquery);
  };
  walk(ast);
  return [...found];
}

test('no ROW-LEVEL workspace-partitioned query touches a table with encrypted fields', () => {
  const encryptedTables = new Set(Object.keys(encryptedFieldsConfig));
  for (const [name, spec] of WORKSPACE_PARTITIONED_REGISTRY) {
    if (!spec.routeColumn) continue; // broadcast entries ride the gate plane, which decrypts
    const ast = (spec.base(SAMPLE_ARGS) as { ast?: unknown }).ast;
    assert.ok(ast, `${name}: base AST must resolve for the audit`);
    const offenders = tablesOfAst(ast).filter((t) => encryptedTables.has(t));
    assert.deepEqual(
      offenders,
      [],
      `${name}: row-level plane has NO emit-time decryption — tables ${offenders.join(', ')} carry ` +
        `encrypted fields (encryptedFieldsConfig) and would ship ciphertext. Implement row-level ` +
        `decrypt (mirror the gate-plane rowDecrypt sites) before onboarding this query.`,
    );
  }
});
