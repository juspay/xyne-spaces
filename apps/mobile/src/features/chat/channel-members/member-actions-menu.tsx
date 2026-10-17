import { Platform } from 'react-native';

import { MemberActionsMenu as AndroidMenu } from './member-actions-menu.android';
import { MemberActionsMenu as IosMenu } from './member-actions-menu.ios';

export type { MemberActionsMenuProps } from './member-actions-menu.types';

/**
 * Metro resolves `.ios.tsx` / `.android.tsx` at bundle time. This file exists so
 * TypeScript can resolve the import; it is unused on device when those files exist.
 */
export const MemberActionsMenu = Platform.OS === 'ios' ? IosMenu : AndroidMenu;
