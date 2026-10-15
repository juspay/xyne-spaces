import { StyleSheet } from 'react-native';

import { callColors, callRadii } from './callTheme';

/** The look every call bottom sheet shares: the dark surface and its drag handle. */
export const callSheetStyles = StyleSheet.create({
  surface: {
    backgroundColor: callColors.surface,
    borderTopLeftRadius: callRadii.sheet,
    borderTopRightRadius: callRadii.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: callColors.hairline,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: callColors.sheetHandle,
  },
});
