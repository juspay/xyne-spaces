/**
 * QRScanner - Full-screen QR scanning experience
 */

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';

const SCAN_ACCENT = '#FFFFFF';

interface QRScannerProps {
  title: string;
  instruction: string;
  onQRScanned: (data: string) => void;
  onCancel: () => void;
  onCloseAfterScan?: () => void;
}

export default function QRScanner({
  title,
  instruction,
  onQRScanned,
  onCancel,
  onCloseAfterScan,
}: QRScannerProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const device = useCameraDevice('back');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [isActive, setIsActive] = useState(true);

  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const scanRange = Math.max(windowHeight - insets.top - insets.bottom, 200);

  const background = useCSSVariable('--color-enrollment-background') as string;
  const primaryText = useCSSVariable('--color-enrollment-primary-text') as string;
  const secondaryText = useCSSVariable('--color-enrollment-secondary-text') as string;
  const surface = useCSSVariable('--color-enrollment-surface') as string;
  const accent = useCSSVariable('--color-enrollment-accent') as string;
  const isDarkBarStyle = primaryText === '#f8fafc';

  useEffect(() => {
    (async () => {
      try {
        const permission = await Camera.requestCameraPermission();
        const granted = permission === 'granted';
        setHasPermission(granted);
        if (!granted) {
          Alert.alert('Camera permission required', undefined, [{ text: 'OK', onPress: onCancel }]);
        }
      } catch (error) {
        console.error('[QRScanner] Permission error:', error);
        setHasPermission(false);
        Alert.alert('Camera permission error', 'Could not request camera permission', [
          { text: 'OK', onPress: onCancel },
        ]);
      }
    })();
  }, [onCancel]);

  useEffect(() => {
    if (!isActive || scanned) {
      scanLineAnim.stopAnimation();
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: scanRange,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [isActive, scanned, scanLineAnim, scanRange]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => {
      if (scanned || !codes.length) return;
      const firstCode = codes[0];
      const value = firstCode?.value;
      if (!value) return;

      setScanned(true);
      setIsActive(false);
      onCloseAfterScan?.();
      onQRScanned(value);
    },
  });

  if (hasPermission === null) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: background,
          padding: 20,
        }}
      >
        <StatusBar
          barStyle={isDarkBarStyle ? 'light-content' : 'dark-content'}
          backgroundColor={background}
          translucent={false}
        />
        <Text style={{ color: primaryText, fontSize: 16, textAlign: 'center' }}>
          Requesting camera permission...
        </Text>
      </SafeAreaView>
    );
  }

  if (hasPermission === false) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: background,
          padding: 20,
        }}
      >
        <StatusBar
          barStyle={isDarkBarStyle ? 'light-content' : 'dark-content'}
          backgroundColor={background}
          translucent={false}
        />
        <Text style={{ color: primaryText, fontSize: 16, textAlign: 'center' }}>
          Camera permission denied
        </Text>
        <TouchableOpacity onPress={onCancel}>
          <Text style={{ color: accent, marginTop: 12 }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: background,
          padding: 20,
        }}
      >
        <StatusBar
          barStyle={isDarkBarStyle ? 'light-content' : 'dark-content'}
          backgroundColor={background}
          translucent={false}
        />
        <Text style={{ color: primaryText, fontSize: 16, textAlign: 'center' }}>
          Preparing camera...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={['left', 'right']}>
      <StatusBar
        barStyle={isDarkBarStyle ? 'light-content' : 'dark-content'}
        backgroundColor={background}
        translucent={false}
      />
      <View style={{ flex: 1, backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isActive}
          codeScanner={codeScanner}
          resizeMode='cover'
          androidPreviewViewType='texture-view'
        />

        <View
          pointerEvents='box-none'
          style={{
            ...StyleSheet.absoluteFill,
            justifyContent: 'space-between',
            alignItems: 'stretch',
          }}
        >
          <View
            style={{
              paddingHorizontal: 20,
              paddingBottom: 12,
              backgroundColor: surface,
              alignItems: 'center',
              zIndex: 2,
              elevation: 2,
              paddingTop: insets.top + 16,
            }}
          >
            <Text
              style={{ color: primaryText, fontSize: 22, fontWeight: '700', textAlign: 'center' }}
            >
              {title}
            </Text>
            <Text style={{ color: secondaryText, textAlign: 'center', marginTop: 6 }}>
              {instruction}
            </Text>
          </View>

          {!scanned && (
            <View pointerEvents='none' style={StyleSheet.absoluteFill}>
              <Animated.View
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  height: 3,
                  backgroundColor: SCAN_ACCENT,
                  opacity: 0.9,
                  transform: [{ translateY: scanLineAnim }],
                }}
              />
            </View>
          )}

          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 12,
              backgroundColor: surface,
              zIndex: 2,
              elevation: 2,
              paddingBottom: insets.bottom + 16,
            }}
          >
            <Text
              style={{
                color: primaryText,
                textAlign: 'center',
                marginBottom: 12,
                fontWeight: '700',
              }}
            >
              Align the QR code in view
            </Text>
            <TouchableOpacity
              onPress={onCancel}
              style={{
                alignSelf: 'center',
                paddingHorizontal: 28,
                paddingVertical: 10,
                backgroundColor: 'transparent',
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: accent,
              }}
            >
              <Text style={{ color: accent, fontWeight: '800' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
