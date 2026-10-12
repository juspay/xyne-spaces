/**
 * Two small pieces of state that outlive the deck, both in MMKV.
 *
 * **The pending record.** Answers are collected before there is a session, but the places they are
 * stored (the profile over Zero, the questionnaire endpoint) need one. So the deck writes the
 * record here and the signed-in shell flushes it — which also means a kill between "session
 * created" and "answers stored" retries on the next launch instead of losing them.
 *
 * **The join-request marker.** Asking an existing company for access ends the deck *without*
 * questions. When that request is later approved, the person signs straight in and never sees the
 * deck again — so this marker is what lets the shell ask them once, on the way in. It is local on
 * purpose: only someone who asked from this device is held up, and nobody else's sign-in changes.
 */

import { deleteKeys, getJson, setJson } from '@/src/services/localStorage';

import { normaliseEmail, type PendingOnboarding } from '../model/onboarding-record';

const PENDING_KEY = 'onboarding_pending_record';
const JOIN_REQUEST_KEY = 'onboarding_join_request';

export function writePendingOnboarding(record: PendingOnboarding): void {
  setJson(PENDING_KEY, record);
}

/** The record for this account, or `null` — a record for someone else is left alone. */
export function readPendingOnboarding(email: string): PendingOnboarding | null {
  const stored = getJson<PendingOnboarding>(PENDING_KEY);
  if (!stored || stored.email !== normaliseEmail(email)) {
    return null;
  }
  return stored;
}

export function clearPendingOnboarding(): void {
  deleteKeys([PENDING_KEY]);
}

interface JoinRequestMarker {
  email: string;
  orgName: string;
}

export function rememberJoinRequest(email: string, orgName: string): void {
  setJson(JOIN_REQUEST_KEY, {
    email: normaliseEmail(email),
    orgName,
  } satisfies JoinRequestMarker);
}

/** Whether this account asked a company for access from this device and has not answered since. */
export function hasJoinRequest(email: string): boolean {
  const stored = getJson<JoinRequestMarker>(JOIN_REQUEST_KEY);
  return stored !== null && stored.email === normaliseEmail(email);
}

export function forgetJoinRequest(): void {
  deleteKeys([JOIN_REQUEST_KEY]);
}
