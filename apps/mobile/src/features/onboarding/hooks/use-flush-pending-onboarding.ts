import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { useAuth } from '@/src/contexts/AuthContext';
import { useZero } from '@/src/hooks/useZero';
import { saveOnboardingQuestionnaire } from '@/src/services/onboardingQuestionnaire';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';
import { Event, logger } from '@/src/utils/logger';

import type { PendingOnboarding } from '../model/onboarding-record';
import { clearPendingOnboarding, readPendingOnboarding } from '../state/pending-onboarding';

/**
 * Stores whatever the onboarding deck collected, once there is a session to store it against.
 *
 * Mounted inside the signed-in shell (it needs Zero) and held back until startup has settled, like
 * the other post-startup services. Idempotent: with nothing pending it does a single MMKV read.
 *
 * The record is cleared only after *both* writes land, so a failure — offline, a transient backend
 * error, a kill mid-way — retries on the next launch rather than dropping the answers. Both writes
 * are safe to repeat: the profile upsert reuses the existing profile row and the questionnaire is
 * an upsert per email.
 *
 * Order and failure policy follow the dashboard: profile first, then the questionnaire, and a
 * failure never blocks the person from using the app.
 */
export function useFlushPendingOnboarding({ enabled }: { enabled: boolean }): void {
  const zero = useZero();
  const { user, token } = useAuth();
  const email = user?.email ?? null;
  const isFlushing = useRef(false);

  useEffect(() => {
    if (!enabled || email === null || isFlushing.current) {
      return;
    }
    const record = readPendingOnboarding(email);
    if (record === null) {
      return;
    }

    isFlushing.current = true;
    void flush(zero, record, token ?? undefined)
      .then(clearPendingOnboarding)
      .catch((error: unknown) => {
        logger.warn(Event.LOTUS_AUTH_CHECK, { stage: 'onboarding_flush_failed', error });
      })
      .finally(() => {
        isFlushing.current = false;
      });
  }, [enabled, email, token, zero]);
}

async function flush(
  zero: ReturnType<typeof useZero>,
  record: PendingOnboarding,
  token: string | undefined,
): Promise<void> {
  if (record.displayName !== undefined || record.role !== undefined) {
    await awaitMutation(
      zero.mutate(
        mutators.userProfile.upsert({
          profileId: uuidv4(),
          timestamp: Date.now(),
          ...(record.displayName !== undefined ? { displayName: record.displayName } : {}),
          ...(record.role !== undefined ? { role: record.role } : {}),
        }),
      ),
    );
  }

  await saveOnboardingQuestionnaire(record.questionnaire, token);
}
