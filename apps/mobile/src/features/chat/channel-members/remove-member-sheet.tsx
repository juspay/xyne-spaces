import { Platform } from 'react-native';

import { RemoveMemberSheet as AndroidSheet } from './remove-member-sheet.android';
import { RemoveMemberSheet as IosSheet } from './remove-member-sheet.ios';

export type { RemoveMemberSheetProps } from './remove-member-sheet.types';

/**
 * Metro resolves `.ios.tsx` / `.android.tsx` at bundle time. This file exists so
 * TypeScript can resolve the import; it is unused on device when those files exist.
 */
export const RemoveMemberSheet = Platform.OS === 'ios' ? IosSheet : AndroidSheet;
