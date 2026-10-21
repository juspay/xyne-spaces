import { useRouter, useSegments } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';
import { storedFlag } from '@/src/flags';
import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import { CAC_KEYS, cacService, useCacConfig } from '@/src/services/cac';
import { Event, logger } from '@/src/utils/logger';

import { BetaAvailableBottomSheet } from './BetaAvailableBottomSheet';
import { hasDecidedBetaPromo, markBetaPromoDecided } from './beta-promo-session';
import {
  decideBetaPromo,
  isHomeTabRoute,
  summarizePendingLabels,
  type BetaPromoInput,
} from './promo';
import type { BetaFlag } from './resolve';
import { useBetaFlags } from './use-beta-flags';

const DEFAULT_TITLE = 'Beta features available';
const DEFAULT_MESSAGE = "You have access to beta features you haven't turned on yet.";

/**
 * Lets the first screen settle before a sheet slides over it, and gives a cold
 * deep link time to land so the home-tab check sees where the user really is.
 */
const PRESENT_DELAY_MS = 700;

/**
 * Offers Settings → Beta to users who have been granted beta features in CAC
 * and have not switched all of them on.
 *
 * Decides once per cold start per user, then never again in the process — see
 * `beta-promo-session.ts` for why that cannot be React state. A dismissal is
 * not persisted, so the sheet returns on the next cold start until every
 * visible flag is on.
 */
export function BetaAvailableGate(): ReactElement | null {
  const { isSignedIn, user } = useAuth();
  const { hasFirstFramePainted, isProtectedStartupReady } = useStartupPhase();
  const router = useRouter();
  const segments = useSegments();

  const userId = user?.user_id ?? null;
  const alreadyDecided = userId !== null && hasDecidedBetaPromo(userId);

  // Same startup gate as the update prompt, plus: stop asking once decided.
  const enabled =
    isSignedIn &&
    hasFirstFramePainted &&
    isProtectedStartupReady &&
    userId !== null &&
    !alreadyDecided;

  // Shared cache keys: the Beta screen, the revocation gate and the update
  // prompt read the same queries, so only `lotus_beta_prompt` is a new request.
  const beta = useBetaFlags(enabled);
  const prompt = useCacConfig(CAC_KEYS.betaPrompt, { enabled });
  const update = useCacConfig(CAC_KEYS.lotusUpdateConfig, { enabled });

  const [pending, setPending] = useState<BetaFlag[] | null>(null);

  const isReady =
    enabled && (beta.isResolved || beta.hasError) && prompt.isFetched && update.isFetched;

  // The timer reads the latest inputs without restarting on every route change.
  const inputRef = useRef<Omit<BetaPromoInput, 'isStoredOn'>>({
    promptEnabled: false,
    hasError: false,
    visible: [],
    revokedCount: 0,
    updatePromptDue: false,
    isOnHomeTab: false,
  });
  inputRef.current = {
    promptEnabled: prompt.config.enabled,
    hasError: beta.hasError,
    visible: beta.flags,
    revokedCount: beta.revoked.length,
    // Same evaluation the update prompt uses, including its snooze, so this
    // yields only when that sheet is actually going to appear.
    updatePromptDue: cacService.shouldShowPrompt(cacService.resolveUpdateDecision(update.config)),
    isOnHomeTab: isHomeTabRoute(segments),
  };

  useEffect(() => {
    if (!isReady || userId === null) return;

    const timer = setTimeout((): void => {
      const decision = decideBetaPromo({ ...inputRef.current, isStoredOn: storedFlag });
      markBetaPromoDecided(userId);

      logger.info(Event.LOTUS_STARTUP_DIAGNOSTIC, {
        stage: 'beta_promo_decision',
        show: decision.show,
        ...(decision.show
          ? { pendingCount: decision.pending.length }
          : { reason: decision.reason }),
      });

      if (decision.show) {
        setPending(decision.pending);
      }
    }, PRESENT_DELAY_MS);

    // Unmounted before deciding (remount, sign-out): nothing is marked, so the
    // next mount decides instead.
    return (): void => {
      clearTimeout(timer);
    };
  }, [isReady, userId]);

  const handleClosed = useCallback((): void => {
    setPending(null);
  }, []);

  const handleOpenBeta = useCallback((): void => {
    router.push('/settings/beta');
  }, [router]);

  if (pending === null || pending.length === 0) return null;

  return (
    <BetaAvailableBottomSheet
      title={prompt.config.title || DEFAULT_TITLE}
      message={prompt.config.message || DEFAULT_MESSAGE}
      pendingSummary={summarizePendingLabels(pending)}
      onOpenBeta={handleOpenBeta}
      onClosed={handleClosed}
    />
  );
}
