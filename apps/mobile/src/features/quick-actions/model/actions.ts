import type { ComponentType } from 'react';
import { Mic, Phone } from 'lucide-react-native';

import type { TabName } from '@/src/navigation/routes';

import { ContactCardIcon } from '../icons';

export type QuickActionId = 'create-dm' | 'instant-call' | 'record-note';

/**
 * The shape a lucide icon and one of ours both satisfy, so an action can
 * carry either and the pill never has to know which it got.
 */
export type QuickActionIcon = ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

export type QuickAction = {
  readonly id: QuickActionId;
  readonly label: string;
  readonly icon: QuickActionIcon;
};

/**
 * Every action, and the order they are drawn in — top to bottom.
 *
 * One order for the whole app rather than one per screen, so an action that
 * appears on two tabs keeps the same position on both. A screen's list is
 * this, filtered; it never reorders.
 *
 * Document order is also animation order: the row at index 0 folds the
 * furthest, so the stack collapses towards the button.
 */
export const QUICK_ACTIONS = [
  { id: 'instant-call', label: 'Start instant Call', icon: Phone },
  { id: 'create-dm', label: 'New Message', icon: ContactCardIcon },
  { id: 'record-note', label: 'Record Note', icon: Mic },
] as const satisfies readonly QuickAction[];

/**
 * On every tab that has the button at all.
 *
 * These are app-level actions rather than screen-level ones — neither
 * depends on what you were looking at when you reached for it.
 */
const SHARED_ACTIONS: readonly QuickActionId[] = ['instant-call', 'record-note'];

/**
 * What each tab adds on top of the shared pair.
 *
 * A tab absent from here has no entry, which is also how a tab opts out of
 * the button entirely. The destinations that are not tab screens — Canvas,
 * Recordings, Report an issue — never reach this: they are pushed routes
 * outside the tab navigator, so they have no shell furniture to opt out of.
 */
const TAB_ACTIONS = {
  dms: ['create-dm'],
  // channels: ['create-channel'], ← lands with the channels redesign
} as const satisfies Partial<Record<TabName, readonly QuickActionId[]>>;

type TabWithActions = keyof typeof TAB_ACTIONS;

function hasActions(tab: TabName): tab is TabWithActions {
  return Object.prototype.hasOwnProperty.call(TAB_ACTIONS, tab);
}

/**
 * What a tab's button offers, in display order. Empty means no button.
 */
export function quickActionsForTab(tab: TabName): readonly QuickAction[] {
  if (!hasActions(tab)) return [];

  const allowed = new Set<QuickActionId>([...TAB_ACTIONS[tab], ...SHARED_ACTIONS]);
  return QUICK_ACTIONS.filter(action => allowed.has(action.id));
}
