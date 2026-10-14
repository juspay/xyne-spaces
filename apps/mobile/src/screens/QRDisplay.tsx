/**
 * QRDisplay - Display QR code for scanning
 *
 * Used to display CSR as QR code for enrollment
 */

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import QRCode from 'react-native-qrcode-svg';

const QR_FOREGROUND = '#0F172A';
const QR_BACKGROUND = '#FFFFFF';

interface QRDisplayProps {
  title: string;
  instruction: string;
  data: string;
  onContinue?: () => void;
  onCancel: () => void;
}

export default function QRDisplay({
  title,
  instruction,
  data,
  onContinue,
  onCancel,
}: QRDisplayProps) {
  const [qrError, setQrError] = React.useState<string>('');

  const background = useCSSVariable('--color-enrollment-background') as string;
  const primaryText = useCSSVariable('--color-enrollment-primary-text') as string;
  const secondaryText = useCSSVariable('--color-enrollment-secondary-text') as string;
  const mutedText = useCSSVariable('--color-enrollment-muted-text') as string;
  const buttonBg = useCSSVariable('--color-enrollment-button-bg') as string;
  const buttonText = useCSSVariable('--color-enrollment-button-text') as string;
  const secondaryButtonBorder = useCSSVariable(
    '--color-enrollment-secondary-button-border',
  ) as string;
  const secondaryButtonText = useCSSVariable('--color-enrollment-secondary-button-text') as string;
  const errorBg = useCSSVariable('--color-enrollment-error-bg') as string;
  const errorBorder = useCSSVariable('--color-enrollment-error-border') as string;
  const errorText = useCSSVariable('--color-enrollment-error-text') as string;
  const errorSubtext = useCSSVariable('--color-enrollment-error-subtext') as string;

  React.useEffect(() => {
    if (data.length > 2800) {
      setQrError('Data too large for QR code. Please try again on a secure network.');
      return;
    }
    setQrError('');
  }, [data]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 40 }}>
        <View style={{ marginBottom: 40, alignItems: 'center' }}>
          <Text
            style={{
              fontSize: 28,
              fontWeight: 'bold',
              color: primaryText,
              marginBottom: 12,
              textAlign: 'center',
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontSize: 15,
              color: secondaryText,
              textAlign: 'center',
              lineHeight: 22,
              paddingHorizontal: 20,
            }}
          >
            {instruction}
          </Text>
        </View>

        <View style={{ alignItems: 'center', marginBottom: 40 }}>
          {qrError ? (
            <View
              style={{
                padding: 30,
                backgroundColor: errorBg,
                borderRadius: 20,
                alignItems: 'center',
                borderWidth: 2,
                borderColor: errorBorder,
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '600',
                  color: errorText,
                  marginBottom: 8,
                  textAlign: 'center',
                }}
              >
                {qrError}
              </Text>
              <Text style={{ fontSize: 13, color: errorSubtext, textAlign: 'center' }}>
                Contact support if this persists.
              </Text>
            </View>
          ) : (
            <QRCode
              value={data}
              size={280}
              color={QR_FOREGROUND}
              backgroundColor={QR_BACKGROUND}
              ecl='M'
              enableLinearGradient={false}
              quietZone={12}
            />
          )}
          <Text
            style={{
              marginTop: 16,
              fontSize: 14,
              color: mutedText,
              fontWeight: '500',
            }}
          >
            Scan with your webcam
          </Text>
        </View>

        <View style={{ gap: 12, marginTop: 'auto' }}>
          {onContinue && (
            <TouchableOpacity
              style={{
                backgroundColor: buttonBg,
                paddingVertical: 18,
                borderRadius: 14,
                alignItems: 'center',
                shadowColor: buttonBg,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 4,
              }}
              onPress={() => {
                onContinue();
              }}
            >
              <Text
                style={{
                  color: buttonText,
                  fontSize: 17,
                  fontWeight: '600',
                  letterSpacing: 0.3,
                }}
              >
                Continue
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={{
              backgroundColor: 'transparent',
              paddingVertical: 18,
              borderRadius: 14,
              alignItems: 'center',
              borderWidth: 1.5,
              borderColor: secondaryButtonBorder,
            }}
            onPress={onCancel}
          >
            <Text
              style={{
                color: secondaryButtonText,
                fontSize: 17,
                fontWeight: '600',
              }}
            >
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
