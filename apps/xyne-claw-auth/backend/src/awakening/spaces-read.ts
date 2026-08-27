/**
 * Every Spaces read on the awakening path goes through here.
 *
 * Why this wrapper exists: the Spaces query validator caps `take` at MAX_TAKE
 * (apps/backend/src/services/pythonQuery/validator.ts) — but the cap is
 * declared `.optional()`, so it only binds when `take` is SUPPLIED. An AST
 * with no `take` is an unbounded findMany against Spaces' hottest tables
 * (messages, conversations). A background loop that runs for every awakened
 * agent, every period, forever is exactly the caller that must never emit one.
 *
 * boundedInteract() therefore refuses an AST without an explicit positive
 * `take` — a programming error, surfaced loudly in dev rather than silently
 * becoming a table scan in prod.
 */

import { interact, type QueryAST, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-spaces-read");

/** Mirrors MAX_TAKE in the Spaces validator. Kept local so this stays dependency-free. */
export const SPACES_MAX_TAKE = 1000;

export class UnboundedQueryError extends Error {
  constructor(model: string) {
    super(`Refusing to run an unbounded Spaces query on "${model}": every awakening read must set an explicit take`);
    this.name = "UnboundedQueryError";
  }
}

/**
 * Run a Spaces query AST with a mandatory, in-range `take`.
 * `count` operations are exempt — they return a scalar, not rows.
 */
export async function boundedInteract<T>(ast: QueryAST, auth: SpacesAuthContext): Promise<T> {
  if (ast.operation !== "count") {
    if (typeof ast.take !== "number" || !Number.isFinite(ast.take) || ast.take <= 0) {
      throw new UnboundedQueryError(ast.model);
    }
    if (ast.take > SPACES_MAX_TAKE) {
      log.warn(`[awakening] take=${ast.take} on ${ast.model} exceeds MAX_TAKE; clamping to ${SPACES_MAX_TAKE}`);
      ast.take = SPACES_MAX_TAKE;
    }
  }
  return (await interact(ast, auth)) as T;
}

/**
 * Keyset-paginate a bounded query until `limit` rows are collected or the
 * source is exhausted. Keyset (not skip/offset) because offset pagination over
 * a live table both drifts as rows arrive and degrades linearly with depth.
 *
 * `advance` returns the `where` fragment that resumes strictly AFTER the last
 * row of the previous page; returning null stops paging.
 */
export async function pageBounded<T>(
  base: QueryAST,
  auth: SpacesAuthContext,
  limit: number,
  pageSize: number,
  advance: (lastRow: T) => Record<string, unknown> | null,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: Record<string, unknown> | null = null;

  while (out.length < limit) {
    const take = Math.min(pageSize, limit - out.length, SPACES_MAX_TAKE);
    const where = cursor ? { AND: [base.where ?? {}, cursor] } : base.where;
    const page = await boundedInteract<T[]>(
      { ...base, take, ...(where ? { where } : {}) },
      auth,
    );
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < take) break;

    const last = page[page.length - 1];
    if (last === undefined) break;
    cursor = advance(last);
    if (!cursor) break;
  }

  return out.slice(0, limit);
}
