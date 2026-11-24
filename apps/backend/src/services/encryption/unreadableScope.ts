import { AsyncLocalStorage } from 'async_hooks';
import type { DerivedFacts, RequestContract, RequestDerived } from '@xyne/shared';

/**
 * A request on a contract route (encryptedRoute), from its handler down: its contract and the
 * facts derived from its unreadable fields. The REST counterpart of a contract mutator's
 * `unreadableTransaction`: inside it, code decides on these facts instead of the text, and
 * the database client handles `UnreadableString` (see database/unreadable-extension.ts).
 */
type UnreadableScope = { contract: RequestContract; derived: DerivedFacts | undefined };

const unreadableScopeContext = new AsyncLocalStorage<UnreadableScope>();

export function runInUnreadableScope<T>(scope: UnreadableScope, fn: () => T): T {
  return unreadableScopeContext.run(scope, fn);
}

export function isInUnreadableScope(): boolean {
  return unreadableScopeContext.getStore() !== undefined;
}

/**
 * The facts of `field` in the current request, typed by its contract; `undefined` when the
 * field carried no text. Throws outside a request of `contract`'s route: facts exist only
 * where encryptedRoute derived them.
 */
export function requestFacts<C extends RequestContract, F extends keyof RequestDerived<C>['fields']>(
  contract: C,
  field: F,
): RequestDerived<C>['fields'][F] | undefined {
  const scope = unreadableScopeContext.getStore();
  if (scope?.contract !== contract) {
    throw new Error(`requestFacts(${String(field)}) outside its contract route; mount encryptedRoute(contract) on the route`);
  }
  const fields = scope.derived?.fields as RequestDerived<C>['fields'] | undefined;
  return fields?.[field];
}
