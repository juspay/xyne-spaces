import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable } from 'react-native';
import { styles } from './styles';
import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';
import { LogOut, PhoneOff } from 'lucide-react-native';
import { callColors } from '../callTheme';

interface EndCallDrawerProps {
  isVisible: boolean;
  onClose: () => void;
  onLeaveCall: () => void;
  onEndForEveryone: () => void;
  isHost: boolean;
  participantCount: number;
}

export function EndCallDrawer({
  isVisible,
  onClose,
  onLeaveCall,
  onEndForEveryone,
  isHost,
  participantCount,
}: EndCallDrawerProps): React.ReactElement {
  const insets = useRawSafeAreaInsets();

  if (!isHost) return <></>;

  const otherCount = participantCount - 1;
  const subtitleText =
    otherCount > 0
      ? `${otherCount} other ${otherCount === 1 ? 'participant is' : 'participants are'} still in the call`
      : "You're the only one in this call";

  const handleLeave = () => {
    onLeaveCall();
    onClose();
  };
  const handleEndAll = () => {
    onEndForEveryone();
    onClose();
  };

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType='slide'
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 8, 24) }]}
          onPress={e => e.stopPropagation()}
        >
          {/* Drag handle */}
          <View style={styles.handleBar} />

          {/* Title block */}
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Leave or end the call?</Text>
            <Text style={styles.subtitle}>{subtitleText}</Text>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Actions */}
          <View style={styles.actions}>
            {/* Leave */}
            <TouchableOpacity style={styles.actionRow} onPress={handleLeave} activeOpacity={0.6}>
              <View style={[styles.iconWrap, styles.iconLeave]}>
                <LogOut size={18} color={callColors.onColor} strokeWidth={2.2} />
              </View>
              <View style={styles.actionText}>
                <Text style={styles.actionTitle}>Leave the call</Text>
                <Text style={styles.actionDesc}>Others can continue without you</Text>
              </View>
            </TouchableOpacity>

            <View style={styles.rowDivider} />

            {/* End for everyone */}
            <TouchableOpacity style={styles.actionRow} onPress={handleEndAll} activeOpacity={0.6}>
              <View style={[styles.iconWrap, styles.iconEnd]}>
                <PhoneOff size={18} color={callColors.onColor} strokeWidth={2.2} />
              </View>
              <View style={styles.actionText}>
                <Text style={[styles.actionTitle, styles.actionTitleDanger]}>End for everyone</Text>
                <Text style={styles.actionDesc}>Removes all participants from the call</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Cancel */}
          <TouchableOpacity style={styles.cancelButton} onPress={onClose} activeOpacity={0.6}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
