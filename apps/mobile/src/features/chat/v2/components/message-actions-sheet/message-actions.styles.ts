import { StyleSheet } from 'react-native';

export const messageActionsStyles = StyleSheet.create({
  transparentSheetBackground: {
    backgroundColor: 'transparent',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  floatingScrollContent: {
    alignItems: 'center',
    paddingBottom: 20,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  floatingContent: { gap: 10, maxWidth: 460, width: '100%' },
  reactionRail: {
    alignItems: 'center',
    borderRadius: 999,
    elevation: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    width: '100%',
  },
  quickReactionButton: {
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
    overflow: 'hidden',
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    width: '100%',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 18,
    marginVertical: 6,
  },
});
