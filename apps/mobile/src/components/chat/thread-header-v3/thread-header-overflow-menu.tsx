import { Platform } from 'react-native';

import { ThreadHeaderOverflowMenu as AndroidMenu } from './thread-header-overflow-menu.android';
import { ThreadHeaderOverflowMenu as IosMenu } from './thread-header-overflow-menu.ios';

export type { ThreadHeaderOverflowMenuProps } from './thread-header-overflow-menu.types';

/**
 * Metro resolves `.ios.tsx` / `.android.tsx` at bundle time. This file exists so
 * TypeScript can resolve the import; it is unused on device when those files exist.
 */
export const ThreadHeaderOverflowMenu = Platform.OS === 'ios' ? IosMenu : AndroidMenu;
