/**
 * `IdScope` — the batteries-included default `TFilter`.
 *
 * A host that doesn't want to design its own list predicate can use this: the
 * authorizer returns `all` / `none` / an explicit id set, and the adapter applies
 * it as a plain filter. The in-memory adapter speaks exactly this, so the SDK
 * works zero-config out of the box.
 *
 * NOTE: id-enumeration does not scale — it materialises every visible id and
 * defeats pagination. It is fine for tests, small tenants, and getting started.
 * A production host should define its own `TFilter` (a tenant key, a principal,
 * a query fragment) and push it into a single indexed query. That is the whole
 * point of `TFilter` being opaque to the SDK.
 */

export type IdScope =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'ids'; ids: string[] };

/** Apply an {@link IdScope} to an in-memory collection. */
export function applyIdScope<T extends { id: string }>(items: T[], scope: IdScope): T[] {
  if (scope.kind === 'all') return items;
  if (scope.kind === 'none') return [];
  const allowed = new Set(scope.ids);
  return items.filter((i) => allowed.has(i.id));
}
