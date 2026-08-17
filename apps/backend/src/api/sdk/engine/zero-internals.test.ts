/**
 * Guards the one genuinely fragile dependency in the public API.
 *
 * The read engine compiles ZQL to SQL using five modules that live inside
 * @rocicorp/zero's build output. They are private — the library makes no
 * promise about them across versions — so an upgrade could move or rename them
 * and the failure would otherwise surface at runtime, on a live request.
 *
 * This test makes that break a CI failure instead: it asserts every internal
 * still resolves and is callable, and that the installed version still matches
 * the version those internals were verified against. When this fails after a
 * dependency bump, that is the signal to re-verify the engine and update the
 * pin — never to just widen the assertion.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  PINNED_ZERO_VERSION,
  asQueryInternals,
  executePostgresQuery,
  getServerSchema,
} from './zero-internals';

const nodeRequire = createRequire(__filename);

/**
 * `@rocicorp/zero` does not export its package.json, so read it off the
 * resolved entry point's directory instead of requiring the subpath.
 */
function installedZeroVersion(): string {
  const marker = `${'/node_modules/'}@rocicorp/zero/`;
  const entry = nodeRequire.resolve('@rocicorp/zero');
  const root = entry.slice(0, entry.indexOf(marker) + marker.length);
  return (JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { version: string }).version;
}

describe('zero internals lock', () => {
  it('is pinned to the verified @rocicorp/zero version', () => {
    expect(installedZeroVersion()).toBe(PINNED_ZERO_VERSION);
  });

  it('resolves every private module the read engine depends on', () => {
    expect(typeof asQueryInternals).toBe('function');
    expect(typeof executePostgresQuery).toBe('function');
    expect(typeof getServerSchema).toBe('function');
  });
});
