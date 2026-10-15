import { useCallback, useEffect, useState } from 'react';
import { useSelector } from '@xstate/react';
import { v4 as uuidv4 } from 'uuid';

import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

import {
  hasGlobalNotificationSettingsCaughtUp,
  resolveDisplayedGlobalNotificationSettings,
  type GlobalNotificationSettingsUpdate,
  type GlobalNotificationSettingsValues,
} from '@/src/utils/globalNotificationSettings';

export type { GlobalNotificationSettingsUpdate };

export type GlobalNotificationSettings = GlobalNotificationSettingsValues & {
  update: (fields: GlobalNotificationSettingsUpdate) => void;
};

/**
 * Workspace-wide notification defaults. Channel settings inherit these when the
 * per-channel override is null (same contract as dashboard).
 *
 * Reads through the shared query adapter so Zero optimistic writes and the
 * REST fallback stay consistent with the rest of the app. Local pending
 * fields cover the gap until that row is visible. The state machine snapshot
 * is only a last-resort fallback.
 */
export function useGlobalNotificationSettings(): GlobalNotificationSettings {
  const zero = useZero();
  const [queriedPreference] = useQuery(queries.getCurrentUserPreference({}));
  const machinePreference = useSelector(stateMachineActor, state => state.context.userPreference);
  const [pending, setPending] = useState<GlobalNotificationSettingsUpdate | null>(null);
  const userPreference = queriedPreference ?? machinePreference;

  useEffect(() => {
    if (!pending || !userPreference) return;
    if (hasGlobalNotificationSettingsCaughtUp(pending, userPreference)) {
      setPending(null);
    }
  }, [pending, userPreference]);

  const update = useCallback(
    (fields: GlobalNotificationSettingsUpdate): void => {
      setPending(current => ({ ...current, ...fields }));
      void zero.mutate(
        mutators.userPreference.setGlobalNotificationSettings({
          id: userPreference?.id ?? uuidv4(),
          ...fields,
          timestamp: Date.now(),
        }),
      );
    },
    [userPreference?.id, zero],
  );

  return {
    ...resolveDisplayedGlobalNotificationSettings(userPreference, pending),
    update,
  };
}
