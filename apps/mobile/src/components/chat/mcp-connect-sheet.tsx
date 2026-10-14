import { memo, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useCSSVariable } from 'uniwind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { Button } from '@/src/components/ui/button';
import { useMcpCredentialFields } from '@/src/hooks/useMcpCredentialFields';
import { createMcpConnection } from '@/src/services/claw/clawMcpService';
import type { McpServer } from '@/src/services/claw/clawMcpTypes';

type McpConnectSheetProps = {
  server: McpServer | null;
  userId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
};

const McpConnectSheetComponent = ({
  server,
  userId,
  isOpen,
  onOpenChange,
  onConnected,
}: McpConnectSheetProps): ReactElement | null => {
  const insets = useSafeAreaInsets();
  const { fieldsFor, loading: fieldsLoading } = useMcpCredentialFields();
  const borderColor = useCSSVariable('--color-border') as string;
  const muted = useCSSVariable('--color-muted-foreground') as string;
  const foreground = useCSSVariable('--color-foreground') as string;
  const surface = useCSSVariable('--color-background') as string;

  const fields = useMemo(() => (server ? fieldsFor(server) : []), [fieldsFor, server]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setValues({});
      setError(null);
    }
  }, [isOpen, server?.id]);

  if (!server) return null;

  const missingRequired = fields.some(
    field => !field.optional && !(values[field.name] ?? '').trim(),
  );

  const handleSubmit = async (): Promise<void> => {
    if (submitting || fieldsLoading || missingRequired) return;
    setError(null);
    setSubmitting(true);
    try {
      await createMcpConnection(userId, server.id, values);
      onConnected();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect. Check the details above.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      // Fullscreen gives the sheet a full-height detent so `extend` can
      // shrink content above the keyboard (dynamic height has nowhere to grow).
      mode='fullscreen'
      keyboardBehavior='extend'
      android_keyboardInputMode='adjustResize'
      backdropOpacity={0.4}
    >
      <BottomSheetScrollView
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 24) + 16,
          gap: 16,
        }}
      >
        <View style={{ gap: 4 }}>
          <Text className='text-base font-semibold text-foreground'>Connect {server.name}</Text>
          <Text className='text-xs leading-5 text-foreground'>
            These details are sent to the connector and stored encrypted.
          </Text>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text className='text-sm font-semibold text-foreground' numberOfLines={1}>
              {server.name}
            </Text>
            {server.description ? (
              <Text className='text-xs leading-4 text-foreground' numberOfLines={2}>
                {server.description}
              </Text>
            ) : null}
          </View>
        </View>

        {fieldsLoading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
            <ActivityIndicator size='small' />
            <Text className='text-sm text-foreground'>Checking what this connector needs…</Text>
          </View>
        ) : fields.length === 0 ? (
          <Text className='text-sm text-foreground'>No additional details needed.</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {fields.map(field => (
              <View key={field.name} style={{ gap: 6 }}>
                <Text className='text-xs font-medium text-foreground'>
                  {field.label}
                  {field.optional ? '' : ' *'}
                </Text>
                <BottomSheetTextInput
                  value={values[field.name] ?? ''}
                  onChangeText={text =>
                    setValues(prev => ({
                      ...prev,
                      [field.name]: text,
                    }))
                  }
                  placeholder={field.placeholder || field.label}
                  placeholderTextColor={muted}
                  secureTextEntry={field.type === 'password'}
                  autoCapitalize='none'
                  autoCorrect={false}
                  style={{
                    borderWidth: 1,
                    borderColor,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    color: foreground,
                    backgroundColor: surface,
                    fontSize: 14,
                  }}
                />
              </View>
            ))}
          </View>
        )}

        {error ? <Text className='text-xs leading-5 text-destructive'>{error}</Text> : null}

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <Button
            label='Cancel'
            variant='secondary'
            size='sm'
            onPress={() => onOpenChange(false)}
          />
          <Button
            label={submitting ? 'Connecting…' : 'Connect'}
            variant='primary'
            size='sm'
            loading={submitting}
            disabled={submitting || fieldsLoading || missingRequired}
            onPress={() => void handleSubmit()}
          />
        </View>
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
};

const McpConnectSheet = memo(McpConnectSheetComponent);
McpConnectSheet.displayName = 'McpConnectSheet';

export { McpConnectSheet };
