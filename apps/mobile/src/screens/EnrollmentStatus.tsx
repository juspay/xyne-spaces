/**
 * EnrollmentStatus - Success/Error status screen
 *
 * Displays the enrollment result or an error message.
 */

import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

interface EnrollmentStatusProps {
  success: boolean;
  error?: string;
  onRetry?: () => void;
}

export default function EnrollmentStatus({
  success,
  error,
  onRetry,
}: EnrollmentStatusProps): React.JSX.Element {
  const background = useCSSVariable('--color-enrollment-background') as string;
  const surface = useCSSVariable('--color-enrollment-surface') as string;
  const primaryText = useCSSVariable('--color-enrollment-primary-text') as string;
  const secondaryText = useCSSVariable('--color-enrollment-secondary-text') as string;
  const accent = useCSSVariable('--color-enrollment-accent') as string;
  const errorBorder = useCSSVariable('--color-enrollment-error-border') as string;
  const errorText = useCSSVariable('--color-enrollment-error-text') as string;
  const buttonBg = useCSSVariable('--color-enrollment-button-bg') as string;
  const buttonText = useCSSVariable('--color-enrollment-button-text') as string;

  if (success) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20 }}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text
              style={{
                fontSize: 28,
                fontWeight: 'bold',
                color: primaryText,
                marginBottom: 10,
                textAlign: 'center',
              }}
            >
              Enrollment Successful
            </Text>
            <Text
              style={{
                fontSize: 16,
                color: secondaryText,
                textAlign: 'center',
                marginBottom: 30,
                lineHeight: 24,
                paddingHorizontal: 20,
              }}
            >
              Your device has been enrolled and is ready to use
            </Text>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 24,
                gap: 10,
              }}
            >
              <ActivityIndicator size='small' color={accent} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: primaryText }}>
                Redirecting you to Xyne Spaces...
              </Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20 }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text
            style={{
              fontSize: 28,
              fontWeight: 'bold',
              color: primaryText,
              marginBottom: 10,
              textAlign: 'center',
            }}
          >
            Enrollment Failed
          </Text>
          <Text
            style={{
              fontSize: 16,
              color: secondaryText,
              textAlign: 'center',
              marginBottom: 30,
              lineHeight: 24,
              paddingHorizontal: 20,
            }}
          >
            We couldn&apos;t complete the enrollment process
          </Text>

          <View
            style={{
              width: '100%',
              backgroundColor: surface,
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
              borderLeftWidth: 4,
              borderLeftColor: errorBorder,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
              elevation: 3,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '600',
                color: errorText,
                marginBottom: 8,
              }}
            >
              Error Details:
            </Text>
            <Text style={{ fontSize: 14, color: secondaryText, lineHeight: 20 }}>
              {error || 'An unknown error occurred'}
            </Text>
          </View>

          <View
            style={{
              width: '100%',
              backgroundColor: surface,
              borderRadius: 12,
              padding: 20,
              marginBottom: 30,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
              elevation: 3,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: '600',
                color: primaryText,
                marginBottom: 12,
              }}
            >
              Troubleshooting:
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginBottom: 8,
              }}
            >
              <Text style={{ fontSize: 16, color: accent, marginRight: 8, lineHeight: 20 }}>•</Text>
              <Text style={{ flex: 1, fontSize: 14, color: secondaryText, lineHeight: 20 }}>
                Check your internet connection
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginBottom: 8,
              }}
            >
              <Text style={{ fontSize: 16, color: accent, marginRight: 8, lineHeight: 20 }}>•</Text>
              <Text style={{ flex: 1, fontSize: 14, color: secondaryText, lineHeight: 20 }}>
                Ensure you have proper authorization
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginBottom: 8,
              }}
            >
              <Text style={{ fontSize: 16, color: accent, marginRight: 8, lineHeight: 20 }}>•</Text>
              <Text style={{ flex: 1, fontSize: 14, color: secondaryText, lineHeight: 20 }}>
                Scan a newly generated enrollment QR code
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginBottom: 8,
              }}
            >
              <Text style={{ fontSize: 16, color: accent, marginRight: 8, lineHeight: 20 }}>•</Text>
              <Text style={{ flex: 1, fontSize: 14, color: secondaryText, lineHeight: 20 }}>
                Contact support if the problem persists
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={{
              backgroundColor: buttonBg,
              paddingHorizontal: 40,
              paddingVertical: 16,
              borderRadius: 12,
              width: '100%',
              alignItems: 'center',
            }}
            onPress={onRetry}
          >
            <Text style={{ color: buttonText, fontSize: 18, fontWeight: '600' }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
