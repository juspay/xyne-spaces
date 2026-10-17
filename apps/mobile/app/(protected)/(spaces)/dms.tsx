import { type ReactElement } from 'react';

import { DmsScreen } from '@/src/features/dms';
import { useFlag } from '@/src/flags';
import DmScreen from '@/src/screens/tabs/dms-screen';

import { SpacesTabScreen } from './_tab-screen';

/**
 * Route shell.
 *
 * The classic screen renders its list only and takes its header and its focus
 * context from the chrome, so it keeps the `SpacesTabScreen` wrapper. The new
 * one owns its header and needs no wrapper at all: this navigator mounts one
 * scene per tab and tracks which is selected, so `useIsFocused()` — what
 * `useTabPageIsFocused` falls back to with no provider — is already the right
 * answer. The pager context exists for the classic shell, which mounts all
 * five pages at once and would otherwise report every one of them focused.
 */
export default function Screen(): ReactElement {
  if (useFlag('ui.dms')) {
    return <DmsScreen />;
  }

  return (
    <SpacesTabScreen tab='dms'>
      <DmScreen />
    </SpacesTabScreen>
  );
}
