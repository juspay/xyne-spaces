/**
 * Guards the final synchronous write after an asynchronous device registration.
 * The network request cannot always be cancelled, so its completion must prove
 * that the session and the token it started with are still current.
 */
export function canCommitDeviceRegistration(
  fcmToken: string,
  lastToken: string | null,
  isCurrent: () => boolean,
): boolean {
  return Boolean(fcmToken.trim()) && fcmToken !== lastToken && isCurrent();
}

export function canCommitVoipRegistration(
  voipToken: string,
  pendingToken: string | null,
  isCurrent: () => boolean,
): boolean {
  return pendingToken === voipToken && isCurrent();
}
