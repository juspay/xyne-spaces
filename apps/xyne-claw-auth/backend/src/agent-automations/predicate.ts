/**
 * Optional cheap body predicate for per-resource scoping.
 *
 * GitHub/Bitbucket webhooks are repo-level: one URL fires for EVERY comment in
 * the repo. `matchPredicate` narrows a subscription to a single resource (e.g.
 * PR #123) BEFORE spending an expensive agent run. It is a flat map of
 * dot-paths to expected scalar values, all of which must equal the value found
 * at that path in the payload body (AND semantics).
 *
 *   matchPredicate = { "issue.number": 123, "action": "created" }
 *
 * This is the one addition beyond xyne-spaces' strict one-URL-one-automation
 * model. Dependency-free and side-effect-free.
 */

export type Predicate = Record<string, string | number | boolean | null>;

function valueAtPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** True when every declared path in the predicate strictly equals the body value. */
export function matchesPredicate(body: Record<string, unknown>, predicate: Predicate | null | undefined): boolean {
  if (!predicate || Object.keys(predicate).length === 0) return true;
  for (const [path, expected] of Object.entries(predicate)) {
    if (valueAtPath(body, path) !== expected) return false;
  }
  return true;
}
