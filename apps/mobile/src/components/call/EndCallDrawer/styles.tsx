import { StyleSheet } from 'react-native';
import { callColors } from '../callTheme';

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: callColors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    // Subtle top border for glass separation
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },

  // Handle
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: 20,
  },

  // Title
  titleBlock: {
    marginBottom: 20,
  },
  title: {
    color: callColors.onColor,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '400',
    letterSpacing: 0.1,
  },

  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginBottom: 4,
  },

  // Action rows
  actions: {
    backgroundColor: callColors.surfaceRaised,
    borderRadius: 14,
    overflow: 'hidden',
    marginVertical: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginLeft: 62, // aligns with text, after icon
  },

  // Icons
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconLeave: {
    backgroundColor: 'rgba(255,184,0,0.18)',
    // tint the icon via wrapper
  },
  iconEnd: {
    backgroundColor: 'rgba(255,59,48,0.18)',
  },

  // Text
  actionText: {
    flex: 1,
    gap: 2,
  },
  actionTitle: {
    color: callColors.onColor,
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  actionTitleDanger: {
    color: '#FF453A',
  },
  actionDesc: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 12,
    fontWeight: '400',
  },

  // Cancel
  cancelButton: {
    backgroundColor: callColors.surfaceRaised,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  cancelText: {
    color: callColors.onColor,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
});
