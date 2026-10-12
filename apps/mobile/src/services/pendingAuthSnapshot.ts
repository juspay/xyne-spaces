/**
 * A sign-in that has not become a workspace session yet, kept across a process kill.
 *
 * A person who authenticates but belongs to no workspace has no `User` and no token: the backend
 * hands them a short-lived pending-auth cookie and nothing else, and `AuthContext` kept the rest
 * — who they are, why they were not placed — in `useState`. Killing the app mid-onboarding threw
 * all of it away, and the boot path only restores a *workspace* session, so they landed on login
 * again with the deck unreachable.
 *
 * This is the part that can be kept on the device. It deliberately holds no credential: the
 * pending-auth cookie stays in the native cookie jar, and a restore is only honoured while that
 * cookie is still there (see `restorePendingAuth` in `AuthContext`). The snapshot answers "who is
 * this and what do we show them"; the jar answers "may they still act".
 *
 * Pure on purpose — time is passed in and storage is the caller's — so the rules are testable
 * without a native module.
 */

import type { PendingAuthState } from '@/src/contexts/AuthContext';

export const PENDING_AUTH_SNAPSHOT_KEY = '@lotus_pending_auth_snapshot_v1';

/**
 * The pending-auth cookie lives 10 minutes (`AuthServices.verifyEmailRegistration`). Trusting a
 * snapshot for the full ten would restore people onto a card whose last step is already bound to
 * fail, so this stops a minute early.
 */
export const PENDING_AUTH_TTL_MS = 9 * 60_000;

/** Tolerates a device clock that has stepped back slightly between save and read. */
const CLOCK_SKEW_MS = 60_000;

const SNAPSHOT_VERSION = 1;

type OrgCreationPending = Extract<PendingAuthState, { kind: 'org_creation_required' }>;

export interface StoredPendingAuth {
  v: typeof SNAPSHOT_VERSION;
  savedAt: number;
  state: OrgCreationPending;
}

/**
 * Whether a pending sign-in is one the deck can pick up again.
 *
 * Mirrors `toOnboardingContext` in the onboarding feature, which is the authority on when the
 * deck applies: only `org_creation_required`, and not for an account that was removed from its
 * workspaces. Kept here rather than imported so `AuthContext` does not depend on a feature; a
 * test pins the two together.
 */
export function isRestorablePendingAuth(
  state: PendingAuthState | null,
): state is OrgCreationPending {
  return (
    state !== null && state.kind === 'org_creation_required' && state.userExistsButRemoved !== true
  );
}

/** The record to persist for this state, or `null` when there is nothing worth keeping. */
export function encodePendingAuth(
  state: PendingAuthState | null,
  now: number,
): StoredPendingAuth | null {
  if (!isRestorablePendingAuth(state)) {
    return null;
  }
  return { v: SNAPSHOT_VERSION, savedAt: now, state };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The state to restore from a stored record, or `null` when it should be discarded.
 *
 * Distrusts everything: this is read from disk at boot, after app updates and across schema
 * changes, and a bad value here must degrade to the login screen rather than throw during
 * startup.
 */
export function decodePendingAuth(raw: unknown, now: number): OrgCreationPending | null {
  if (!isRecord(raw) || raw['v'] !== SNAPSHOT_VERSION) {
    return null;
  }

  const savedAt = raw['savedAt'];
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) {
    return null;
  }

  const age = now - savedAt;
  if (age > PENDING_AUTH_TTL_MS || age < -CLOCK_SKEW_MS) {
    return null;
  }

  const state = raw['state'];
  if (!isRecord(state) || state['kind'] !== 'org_creation_required') {
    return null;
  }

  const profile = state['profile'];
  if (
    !isRecord(profile) ||
    typeof profile['email'] !== 'string' ||
    profile['email'].length === 0 ||
    typeof profile['name'] !== 'string'
  ) {
    return null;
  }

  const candidate = state as unknown as OrgCreationPending;
  return isRestorablePendingAuth(candidate) ? candidate : null;
}
