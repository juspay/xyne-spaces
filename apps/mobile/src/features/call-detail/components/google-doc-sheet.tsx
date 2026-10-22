import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as WebBrowser from 'expo-web-browser';
import { ExternalLink, FileText } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { isMtlsRequestError } from '@/src/services/apiClient';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';

import { callDetailService, type CallGoogleDocContext } from '../services/call-detail-service';

function apiErrorMessage(error: unknown, fallback: string): string {
  if (isMtlsRequestError(error)) {
    try {
      const parsed = JSON.parse(error.responseBody ?? '') as { error?: unknown };
      if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    } catch {
      // Not JSON — fall through.
    }
  }
  return fallback;
}

export function GoogleDocSheet({
  isOpen,
  onClose,
  callExternalId,
  title,
  webReturnPath,
}: {
  isOpen: boolean;
  onClose: () => void;
  callExternalId: string;
  title: string;
  webReturnPath: string;
}): ReactElement {
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const { accentBg, accentFg } = useBubbleAccent();
  const [context, setContext] = useState<CallGoogleDocContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      setContext(await callDetailService.getGoogleDocContext(callExternalId));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not prepare the Google Docs export.'));
    } finally {
      setIsLoading(false);
    }
  }, [callExternalId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const handleExport = async (): Promise<void> => {
    setIsExporting(true);
    try {
      const url = await callDetailService.exportGoogleDoc(callExternalId, title);
      void haptics.success();
      showMessageToast('Google Doc created');
      if (url) void Linking.openURL(url).catch(() => undefined);
      void load();
    } catch (err) {
      showMessageToast(apiErrorMessage(err, 'Failed to export to Google Docs'), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleConnect = async (): Promise<void> => {
    setIsConnecting(true);
    try {
      const authUrl = await callDetailService.getGoogleDocConnectUrl(webReturnPath);
      await WebBrowser.openBrowserAsync(authUrl);
      // The OAuth round trip ends on the web app; re-check once the browser closes.
      await load();
    } catch (err) {
      showMessageToast(apiErrorMessage(err, 'Could not start Google sign-in'), 'error');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <AppBottomSheet isOpen={isOpen} onOpenChange={open => !open && onClose()} mode='dynamic'>
      <BottomSheetScrollView
        contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 20, gap: 16 }}
      >
        <View className='pt-1'>
          <Text className='text-lg font-semibold text-foreground'>Export to Google Docs</Text>
          <Text className='text-[13px] leading-[18px] text-secondary-foreground mt-0.5'>
            Creates a Google Doc from this call’s detailed summary.
          </Text>
        </View>

        {isLoading && !context ? (
          <View className='py-8 items-center'>
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className='gap-3'>
            <Text className='text-sm text-secondary-foreground'>{error}</Text>
            <Pressable
              onPress={() => void load()}
              className='self-start rounded-full bg-secondary px-4 h-9 justify-center active:opacity-70'
            >
              <Text className='text-[13px] font-medium text-foreground'>Try again</Text>
            </Pressable>
          </View>
        ) : context ? (
          <View className='gap-4'>
            {context.summary ? (
              <View className='rounded-2xl bg-secondary px-4 py-3'>
                <Text className='text-[13.5px] leading-5 text-foreground' numberOfLines={8}>
                  {context.summary}
                </Text>
              </View>
            ) : (
              <Text className='text-sm text-secondary-foreground'>
                This call has no summary to export yet.
              </Text>
            )}

            {context.documents.length > 0 ? (
              <View className='gap-1'>
                <Text className='text-xs font-semibold uppercase tracking-wide text-secondary-foreground'>
                  Already exported
                </Text>
                {context.documents.map(doc => (
                  <Pressable
                    key={doc.documentId ?? doc.url}
                    onPress={() => void Linking.openURL(doc.url).catch(() => undefined)}
                    className='flex-row items-center gap-2.5 py-2 active:opacity-60'
                  >
                    <FileText size={16} color={muted} />
                    <Text className='flex-1 text-[14px] text-foreground' numberOfLines={1}>
                      {doc.title || 'Google Doc'}
                    </Text>
                    <ExternalLink size={14} color={muted} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {context.canExport ? (
              <Pressable
                onPress={() => void handleExport()}
                disabled={isExporting || !context.summary}
                accessibilityRole='button'
                className='h-12 flex-row items-center justify-center gap-2 rounded-xl active:opacity-90'
                style={{
                  backgroundColor: accentBg,
                  opacity: isExporting || !context.summary ? 0.5 : 1,
                }}
              >
                {isExporting ? (
                  <ActivityIndicator color={accentFg} />
                ) : (
                  <FileText size={17} color={accentFg} />
                )}
                <Text className='text-[15px] font-semibold' style={{ color: accentFg }}>
                  {isExporting
                    ? 'Creating Google Doc…'
                    : context.documents.length > 0
                      ? 'Create another doc'
                      : 'Create Google Doc'}
                </Text>
              </Pressable>
            ) : (
              <View className='gap-3'>
                <Text className='text-[13.5px] leading-5 text-secondary-foreground'>
                  {context.unavailableReason ??
                    'Connect Google Docs to create a document from this call.'}
                </Text>
                <Pressable
                  onPress={() => void handleConnect()}
                  disabled={isConnecting}
                  accessibilityRole='button'
                  className='h-12 flex-row items-center justify-center gap-2 rounded-xl bg-secondary active:opacity-80'
                >
                  {isConnecting ? (
                    <ActivityIndicator color={foreground} />
                  ) : (
                    <ExternalLink size={16} color={foreground} />
                  )}
                  <Text className='text-[15px] font-semibold text-foreground'>
                    Connect Google Docs
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}
