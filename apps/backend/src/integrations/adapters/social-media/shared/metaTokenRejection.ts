export const metaGraphErrorCode = (error: unknown): number | undefined =>
  (error as { response?: { data?: { error?: { code?: number } } } })?.response?.data?.error?.code;

// Meta invalidates a token when the person who connected the account changes their password,
// loses their role, or removes the app (Graph error 190). Page tokens have no expiry date, so
// this is the only sign a Facebook one has died.
export function isMetaTokenRejected(error: unknown): boolean {
  return metaGraphErrorCode(error) === 190;
}
