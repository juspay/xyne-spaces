import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Modal, Platform, StyleSheet, Text, ToastAndroid, View } from 'react-native';

import { triggerHaptic } from '@/src/utils/haptics';

type ToastListener = (message: string) => void;

let toastListener: ToastListener | null = null;

/**
 * Outcome of the action the toast is reporting. Drives the haptic only — the
 * toast itself looks the same either way. Omit it for neutral/informational
 * toasts so they stay silent.
 */
export type ToastTone = 'success' | 'warning' | 'error';

/**
 * Every toast in the app funnels through here, so this is the one place that
 * needs to buzz for a reported outcome. Callers that already fire their own
 * haptic must not pass a tone, or the user feels it twice.
 */
export const showMessageToast = (message: string, tone?: ToastTone): void => {
  if (tone) void triggerHaptic(tone);

  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }

  toastListener?.(message);
};

export const NativeToastModalHost = (): ReactElement => {
  const [message, setMessage] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    toastListener = (nextMessage: string) => {
      setMessage(nextMessage);
      setModalVisible(true);

      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }

      hideTimeoutRef.current = setTimeout(() => {
        setModalVisible(false);
      }, 2000);
    };

    return () => {
      toastListener = null;
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  return (
    <Modal
      animationType='fade'
      transparent
      visible={modalVisible}
      onRequestClose={() => setModalVisible(false)}
    >
      <View pointerEvents='none' style={styles.overlay}>
        <View style={styles.modalView}>
          <Text style={styles.modalText}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalView: {
    margin: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    alignSelf: 'center',
  },
  modalText: {
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
