import type { ComponentType } from 'react';

import { ContactCardIcon } from '../icons';

export type DmsFabActionId = 'create-dm';

/**
 * The shape both a lucide icon and one of ours satisfies, so the list can
 * hold either without the pill caring which it got.
 */
export type DmsFabActionIcon = ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

export type DmsFabAction = {
  readonly id: DmsFabActionId;
  readonly label: string;
  readonly icon: DmsFabActionIcon;
};

/**
 * Top to bottom, as drawn.
 *
 * Document order is also animation order: the row at index 0 collapses the
 * furthest, so the list folds down towards the button rather than away from
 * it. Reordering this reorders the stagger.
 */
export const DMS_FAB_ACTIONS = [
  { id: 'create-dm', label: 'Create a DM', icon: ContactCardIcon },
] as const satisfies readonly DmsFabAction[];
