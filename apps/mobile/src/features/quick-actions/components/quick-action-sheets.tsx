import { useCallback, useRef, type ReactElement } from 'react';
import { useValue } from '@legendapp/state/react';
import { useRouter } from 'expo-router';

import { CreateChannelDrawer } from '@/src/components/chat/create-channel-drawer';
import { CreateDmDrawer } from '@/src/components/chat/create-dm-drawer';
import { useMountWhileOpen } from '@/src/features/global-search/hooks/use-mount-while-open';
import { PeopleSheet } from '@/src/features/schedule-call/components/PeopleSheet';
import {
  NO_PARTICIPANTS,
  type ScheduleCallParticipants,
} from '@/src/features/schedule-call/hooks/useScheduleCallForm';
import { useInstantCall } from '@/src/hooks/useInstantCall';

import {
  closeQuickActionSheet,
  isQuickActionSheetMounted,
  quickActionSheets$,
} from '../state/sheet-store';

/** Same people picker as the Calls tab's instant call; the call starts once the sheet has closed. */
function InstantCallSheet({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}): ReactElement | null {
  const router = useRouter();
  const { startCall } = useInstantCall();
  const picked = useRef<ScheduleCallParticipants | null>(null);
  const sheet = useMountWhileOpen(isOpen, onClose);
  const { onDismiss } = sheet.sheetProps;
  const handleDismiss = useCallback((): void => {
    onDismiss();
    const participants = picked.current;
    picked.current = null;
    if (participants) {
      startCall(participants);
      router.push('/(protected)/native-call');
    }
  }, [onDismiss, router, startCall]);

  if (!sheet.shouldRender) return null;
  return (
    <PeopleSheet
      {...sheet.sheetProps}
      onDismiss={handleDismiss}
      participants={NO_PARTICIPANTS}
      onApply={participants => {
        picked.current = participants;
      }}
      title='Start an instant call'
      confirmLabel='Start call'
    />
  );
}

/**
 * The surfaces the quick actions open, mounted once for the whole shell.
 *
 * Belongs to the layout rather than to a screen. A sheet mounted per screen
 * would exist as many times as there are tabs, each with its own queries and
 * its own bottom-sheet machinery — and would tear itself down the moment the
 * tab behind it changed.
 *
 * Note the two conditions per sheet. `mounted` decides whether it is in the
 * tree, `current` whether it is open. They are not the same moment: a sheet
 * runs its own close animation after `isOpen` goes false, so it has to
 * outlive `current` — and nothing should pay for a sheet at startup that
 * most sessions never open, so it must not precede `mounted` either.
 */
export function QuickActionSheets(): ReactElement {
  const current = useValue(quickActionSheets$.current);
  // Selectors, so each reads as a boolean and re-renders only when that
  // boolean flips — not whenever the set is appended to.
  const hasCreateDm = useValue(() => isQuickActionSheetMounted('create-dm'));
  const hasCreateChannel = useValue(() => isQuickActionSheetMounted('create-channel'));
  const hasInstantCall = useValue(() => isQuickActionSheetMounted('instant-call'));

  return (
    <>
      {hasCreateDm ? (
        <CreateDmDrawer isOpen={current === 'create-dm'} onClose={closeQuickActionSheet} />
      ) : null}

      {hasCreateChannel ? (
        <CreateChannelDrawer
          isOpen={current === 'create-channel'}
          onClose={closeQuickActionSheet}
        />
      ) : null}

      {hasInstantCall ? (
        <InstantCallSheet isOpen={current === 'instant-call'} onClose={closeQuickActionSheet} />
      ) : null}
    </>
  );
}
