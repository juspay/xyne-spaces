import { StyleSheet } from 'react-native';

export const TRANSPARENT_SHEET = {
  backgroundColor: 'transparent',
  borderTopLeftRadius: 0,
  borderTopRightRadius: 0,
} as const;

export const messageActionsChrome = StyleSheet.create({
  rail: {
    alignItems: 'center',
    borderRadius: 999,
    elevation: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    maxWidth: 460,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    width: '100%',
  },
  quickButton: {
    alignItems: 'center',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  actionPanel: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 10,
    maxWidth: 460,
    overflow: 'hidden',
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    width: '100%',
  },
});
