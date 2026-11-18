import type { RequestContract } from './define.js';
import { matchesRoute, normalizeRequestPath } from './route-match.js';
import { replyToConversation } from './contracts/conversations.js';

export const REQUEST_CONTRACTS: ReadonlyArray<RequestContract> = [replyToConversation];

/** Contract for `method` + `path`; `path` may carry a query string and the `/api` prefix. */
export function findRequestContract(method: string, path: string): RequestContract | undefined {
  const normalizedPath = normalizeRequestPath(path);
  return REQUEST_CONTRACTS.find(contract => matchesRoute(contract.route, method, normalizedPath));
}
