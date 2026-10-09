import { type ReactElement } from 'react';
import { useValue } from '@legendapp/state/react';

import { CreateDmDrawer } from '@/src/components/chat/create-dm-drawer';
import { InstantCallSheet } from '@/src/components/call/instant-call-sheet';

import {
  closeQuickActionSheet,
  isQuickActionSheetMounted,
  quickActionSheets$,
} from '../state/sheet-store';

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
  const hasInstantCall = useValue(() => isQuickActionSheetMounted('instant-call'));

  return (
    <>
      {hasCreateDm ? (
        <CreateDmDrawer isOpen={current === 'create-dm'} onClose={closeQuickActionSheet} />
      ) : null}

      {hasInstantCall ? (
        <InstantCallSheet isOpen={current === 'instant-call'} onClose={closeQuickActionSheet} />
      ) : null}
    </>
  );
}
