import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const COMPOSER_GATE_MAX_WAIT_MS = 6_000;

/**
 * Prevents an opening surface from staying permanently non-interactive when a
 * query or anchor prerequisite stalls. The gate is still reset for each
 * identity, but it expires after a bounded wait so the composer remains usable.
 *
 * The deadline is anchored to the moment this identity first blocked, not to
 * the current effect run. `blocked` is a composite of several async readiness
 * inputs that toggle while a cached window and the live query reconcile, and
 * restarting the countdown on each toggle let a slow open hold the composer
 * disabled indefinitely.
 */
export const useBoundedComposerGate = (blocked: boolean, identityKey: string): boolean => {
  const [expiredIdentityKey, setExpiredIdentityKey] = useState<string | null>(null);
  const identityKeyRef = useRef(identityKey);
  const waitRef = useRef<{ identityKey: string; startedAt: number } | null>(null);
  identityKeyRef.current = identityKey;

  useLayoutEffect(() => {
    setExpiredIdentityKey(current => (current === identityKey ? current : null));
  }, [identityKey]);

  useEffect(() => {
    if (!blocked || expiredIdentityKey === identityKey) return;

    const now = Date.now();
    const wait = waitRef.current;
    const isNewIdentity = wait?.identityKey !== identityKey;
    const startedAt = isNewIdentity ? now : wait!.startedAt;
    if (isNewIdentity) {
      waitRef.current = { identityKey, startedAt };
    }

    const timer = setTimeout(
      () => {
        if (identityKeyRef.current !== identityKey) return;
        setExpiredIdentityKey(identityKey);
      },
      Math.max(0, COMPOSER_GATE_MAX_WAIT_MS - (now - startedAt)),
    );

    return (): void => clearTimeout(timer);
  }, [blocked, expiredIdentityKey, identityKey]);

  return blocked && expiredIdentityKey !== identityKey;
};
