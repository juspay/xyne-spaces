// ---------------------------------------------------------------------------
// RecordingsScreen
// Native recordings list + active recording panel.
// Follows the threads.tsx UI pattern: AppHeader, SafeAreaView, LegendList.
// ---------------------------------------------------------------------------

import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { LegendList } from '@legendapp/list/react-native';
import { Mic } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { AppHeader } from '@/src/components/app-header';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { RecordingListItem } from '@/src/components/recordings/RecordingListItem';
import { RecordingControlBar } from '@/src/components/recordings/RecordingControlBar';
import { ActiveRecordingView } from '@/src/components/recordings/ActiveRecordingView';
import { SaveTitleModal } from '@/src/components/recordings/SaveTitleModal';
import { recordingService } from '@/src/services/recordingService';
import {
  useRecordingStore,
  sendRecordingAction,
  useTranscriptStream,
} from '@/src/hooks/useRecordingStore';
import { getRecordingState } from '@/src/stores/recordingStore';
import { logRecordingError } from '@/src/utils/recordingUtils';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';
import type { Recording } from '@/src/types/recordings';

const SHEET_TOP_RADIUS = 28;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const RecordingsScreen = (): ReactElement => {
  const router = useRouter();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const { theme } = useUniwind();

  // ── Recording store state ────────────────────────────────────────────────
  const recordingStatus = useRecordingStore(s => s.status);
  const startTime = useRecordingStore(s => s.startTime);
  const isMicMuted = useRecordingStore(s => s.isMicMuted);
  const pendingAutoStart = useRecordingStore(s => s.pendingAutoStart);
  const pendingStop = useRecordingStore(s => s.pendingStop);
  const isActive = recordingStatus === 'recording' || recordingStatus === 'starting';
  const isStarting = recordingStatus === 'starting';

  const { transcripts } = useTranscriptStream();

  // ── Local state ──────────────────────────────────────────────────────────
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const lastExternalIdRef = useRef<string | null>(null);

  // ── Zero: recordings list ────────────────────────────────────────────────

  const [rawCalls, callsDetails] = useQuery(queries.userRecordings({ limit: 100, start: null }));

  const isLoading = callsDetails.type === 'unknown';

  // Map Zero Call rows to the Recording shape used by RecordingListItem
  const recordings: Recording[] = (rawCalls ?? []).map(call => ({
    id: call.id,
    externalId: call.externalId,
    title: call.title ?? 'Untitled Recording',
    startedAt: new Date(call.startedAt).toISOString(),
    endedAt: call.endedAt !== null ? new Date(call.endedAt).toISOString() : null,
    durationMs: call.endedAt !== null ? call.endedAt - call.startedAt : null,
    hasTranscript: !!call.transcript,
    hasSummary: !!call.aiSummary,
    hasRecording: call.recordingEnabled,
  }));

  // ── Recording actions ────────────────────────────────────────────────────

  const handleStartRecording = useCallback((): void => {
    sendRecordingAction({ type: 'clearTranscripts' });
    sendRecordingAction({ type: 'startRecording' });
  }, []);

  const handleStopRecording = useCallback((): void => {
    const { externalId } = getRecordingState();
    lastExternalIdRef.current = externalId as string | null;
    sendRecordingAction({ type: 'stopRecording' });
    setShowTitleModal(true);
  }, []);

  const handleMuteToggle = useCallback((): void => {
    sendRecordingAction({ type: isMicMuted ? 'resumeRecording' : 'pauseRecording' });
  }, [isMicMuted]);

  // Handle pendingAutoStart / pendingStop from deep-link or WebView bridge
  useEffect(() => {
    if (pendingAutoStart && (recordingStatus === 'idle' || recordingStatus === 'error')) {
      handleStartRecording();
    }
  }, [pendingAutoStart, recordingStatus, handleStartRecording]);

  useEffect(() => {
    if (pendingStop && recordingStatus === 'recording') {
      handleStopRecording();
    }
  }, [pendingStop, recordingStatus, handleStopRecording]);

  // ── Title modal ──────────────────────────────────────────────────────────

  const handleSaveTitle = useCallback(async (title: string): Promise<void> => {
    setIsSavingTitle(true);
    try {
      if (lastExternalIdRef.current) {
        await recordingService.updateRecordingTitle(lastExternalIdRef.current, title);
      }
      setShowTitleModal(false);
      sendRecordingAction({ type: 'clearTranscripts' });
    } catch (err) {
      logRecordingError('RecordingsScreen.saveTitle', err);
      Alert.alert('Error', 'Failed to save recording title.');
    } finally {
      setIsSavingTitle(false);
    }
  }, []);

  // ── Navigation ───────────────────────────────────────────────────────────

  const handleRecordingPress = useCallback(
    (recording: Recording): void => {
      router.push({
        pathname: '/recording/[recordingId]',
        params: { recordingId: recording.externalId },
      });
    },
    [router],
  );

  const handleBack = useCallback((): void => {
    router.back();
  }, [router]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View className='flex-1 bg-primary-bg'>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppHeader absolute={false} className='pb-2'>
          <View className='flex-row flex-1 items-center gap-3'>
            <HeaderBackButton liquidGlass accessibilityLabel='Go back' onPress={handleBack} />
            <AppHeader.Title className='text-foreground'>Recordings</AppHeader.Title>
          </View>
          <View className='flex-row items-center gap-4'>
            <AppHeader.UserGuide />
            <AppHeader.UserProfile />
          </View>
        </AppHeader>

        <View className='flex-1 pt-2'>
          <View
            className='flex-1 overflow-hidden bg-card'
            style={{
              borderTopLeftRadius: SHEET_TOP_RADIUS,
              borderTopRightRadius: SHEET_TOP_RADIUS,
            }}
          >
            {isLoading ? (
              <View className='flex-1 items-center justify-center'>
                <ActivityIndicator size='large' />
              </View>
            ) : isActive ? (
              /* ── Active recording panel ── */
              <ActiveRecordingView transcripts={transcripts} isMicMuted={isMicMuted} />
            ) : recordings.length === 0 ? (
              /* ── Empty state ── */
              <View className='flex-1 items-center justify-center px-8 gap-3'>
                <View className='size-16 rounded-full bg-indigo-500/15 items-center justify-center'>
                  <Mic size={28} color='#6366f1' />
                </View>
                <Text
                  className='text-lg font-semibold text-center'
                  style={{ color: foregroundColor }}
                >
                  No recordings yet
                </Text>
                <Text className='text-sm text-center' style={{ color: mutedColor }}>
                  Tap the record button below to start your first recording.
                </Text>
              </View>
            ) : (
              /* ── Recordings list ── */
              <LegendList
                data={recordings}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <RecordingListItem recording={item} onPress={handleRecordingPress} />
                )}
                extraData={theme}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 16 }}
                recycleItems
              />
            )}

            {/* ── Control bar ── */}
            <RecordingControlBar
              isRecording={recordingStatus === 'recording'}
              isMicMuted={isMicMuted}
              isStarting={isStarting}
              startTime={startTime}
              onStart={handleStartRecording}
              onStop={handleStopRecording}
              onMuteToggle={handleMuteToggle}
            />
          </View>
        </View>
      </SafeAreaView>

      {/* ── Save title modal ── */}
      <SaveTitleModal
        isOpen={showTitleModal}
        startTime={lastExternalIdRef.current ? startTime : null}
        isSaving={isSavingTitle}
        onSave={title => void handleSaveTitle(title)}
        onDismiss={() => setShowTitleModal(false)}
      />
    </View>
  );
};

export default RecordingsScreen;
