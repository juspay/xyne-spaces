/**
 * The single place /api/sdk touches @rocicorp/zero's unpublished internals.
 *
 * These modules are private implementation detail of the library, reached
 * through the `#zero-internal/*` import map in package.json. They are what
 * compiles a ZQL query into SQL, which is how the API serves the entire read
 * catalog with no Zero sync process running.
 *
 * Funnelling every import through this file means a breaking library upgrade
 * surfaces in exactly one place. `zero-internals.test.ts` asserts every private
 * dependency resolves and that the installed version still matches the pin, so the
 * break is caught in CI rather than at runtime.
 */

import { asQueryInternals as _asQueryInternals } from '#zero-internal/query-internals';
import { executePostgresQuery as _executePostgresQuery } from '#zero-internal/pg-query-executor';
import { getServerSchema as _getServerSchema } from '#zero-internal/schema';

/** The exact @rocicorp/zero version these internals were verified against. */
export const PINNED_ZERO_VERSION = '1.6.1';

export interface QueryInternals {
  readonly ast: unknown;
  readonly format: unknown;
}

/** Extract the compiled AST + result format from a built ZQL query. */
export const asQueryInternals = _asQueryInternals as (query: unknown) => QueryInternals;

/** Compile an AST to SQL and run it on the given transaction. */
export const executePostgresQuery = _executePostgresQuery as (
  dbTransaction: unknown,
  ast: unknown,
  format: unknown,
  schema: unknown,
  serverSchema: unknown
) => Promise<unknown>;

/** Introspect the live Postgres schema Zero needs for compilation. */
export const getServerSchema = _getServerSchema as (
  dbTransaction: unknown,
  schema: unknown
) => Promise<unknown>;
