// ---------------------------------------------------------------------------
// RecordingDetailScreen
// Detail view matching the dashboard layout:
// title + metadata row + action buttons (Share / Delete) +
// transcript card + AI summary card + audio player.
// ---------------------------------------------------------------------------

import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Clock, Share2, Trash2, Check, Pencil, X, FileText, Sparkles } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppHeader } from '@/src/components/app-header';
import { RecordingPlayer } from '@/src/components/recordings/RecordingPlayer';
import { ShareRecordingSheet } from '@/src/components/recordings/ShareRecordingSheet';
import { recordingService } from '@/src/services/recordingService';
import { logRecordingError, formatRecordingDuration } from '@/src/utils/recordingUtils';
import { haptics } from '@/src/utils/haptics';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import type { RecordingDetail } from '@/src/types/recordings';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';

const SHEET_TOP_RADIUS = 28;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoStr: string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: ReactElement;
  title: string;
  children: ReactElement;
}): ReactElement {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const borderColor = useCSSVariable('--color-border') as string;

  return (
    <View className='rounded-2xl p-4 gap-3' style={{ borderWidth: 1, borderColor }}>
      <View className='flex-row items-center gap-2'>
        {icon}
        <Text className='text-base font-bold' style={{ color: foregroundColor }}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

function ActionButton({
  icon,
  label,
  onPress,
  disabled,
  danger,
  loading,
}: {
  icon: ReactElement;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  loading?: boolean;
}): ReactElement {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const textColor = danger ? '#EF4444' : foregroundColor;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole='button'
      accessibilityLabel={label}
      className='flex-1 rounded-2xl py-3 items-center gap-1.5 active:opacity-60'
      style={{ borderWidth: 1, borderColor, opacity: disabled || loading ? 0.4 : 1 }}
    >
      {loading ? <ActivityIndicator size='small' color={textColor} /> : icon}
      <Text
        className='text-xs font-medium text-center'
        style={{ color: textColor }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Transcript view
// ---------------------------------------------------------------------------

interface TranscriptViewProps {
  plain: string | null;
  identified: string | null;
  hasIdentified: boolean;
}

function TranscriptView({ plain, identified, hasIdentified }: TranscriptViewProps): ReactElement {
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const text = hasIdentified && identified ? identified : plain;

  if (!text) {
    return (
      <Text className='text-sm italic text-secondary-foreground' style={{ color: mutedColor }}>
        No transcript available.
      </Text>
    );
  }

  return (
    <Text className='text-sm leading-6' style={{ color: foregroundColor }}>
      {text}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// AI Summary view
// ---------------------------------------------------------------------------

function AiSummaryView({ summary }: { summary: string | null }): ReactElement {
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;

  if (!summary) {
    return (
      <Text className='text-sm italic' style={{ color: mutedColor }}>
        No AI summary available.
      </Text>
    );
  }

  return (
    <Text className='text-sm leading-6' style={{ color: foregroundColor }}>
      {summary}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

interface RecordingDetailScreenProps {
  recordingId: string;
}

export function RecordingDetailScreen({ recordingId }: RecordingDetailScreenProps): ReactElement {
  const router = useRouter();

  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const borderColor = useCSSVariable('--color-border') as string;

  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const titleInputRef = useRef<TextInput>(null);

  const [showShareSheet, setShowShareSheet] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [mediaUri, setMediaUri] = useState<string | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────

  const loadRecording = useCallback(async (id: string): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await recordingService.getRecordingDetail(id);
      setRecording(data);
      setEditedTitle(data.title ?? '');
    } catch (err) {
      logRecordingError('RecordingDetailScreen.load', err);
      setError('Failed to load recording. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (recordingId) void loadRecording(recordingId);
  }, [recordingId, loadRecording]);

  // ── Title editing ────────────────────────────────────────────────────────

  const handleEditTitle = useCallback((): void => {
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 80);
  }, []);

  const handleCancelEdit = useCallback((): void => {
    setIsEditingTitle(false);
    setEditedTitle(recording?.title ?? '');
  }, [recording]);

  const handleSaveTitle = useCallback(async (): Promise<void> => {
    if (!recording) return;
    const trimmed = editedTitle.trim();
    if (!trimmed) {
      Alert.alert('Invalid title', 'Title cannot be empty.');
      return;
    }
    try {
      await recordingService.updateRecordingTitle(recording.externalId, trimmed);
      setRecording(prev => (prev ? { ...prev, title: trimmed } : prev));
      setIsEditingTitle(false);
    } catch (err) {
      logRecordingError('RecordingDetailScreen.updateTitle', err);
      Alert.alert('Error', 'Failed to update title.');
    }
  }, [recording, editedTitle]);

  // ── Share ────────────────────────────────────────────────────────────────

  const handleShare = useCallback((): void => {
    setShowShareSheet(true);
  }, []);

  // ── Delete ───────────────────────────────────────────────────────────────

  const handleDelete = useCallback((): void => {
    if (!recording) return;
    void haptics.warning();
    Alert.alert(
      'Delete recording',
      `Are you sure you want to delete "${recording.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsDeleting(true);
              await recordingService.deleteRecording(recording.externalId);
              void haptics.success();
              router.back();
            } catch (err) {
              logRecordingError('RecordingDetailScreen.delete', err);
              void haptics.error();
              Alert.alert('Error', 'Failed to delete recording.');
              setIsDeleting(false);
            }
          },
        },
      ],
    );
  }, [recording, router]);

  useEffect(() => {
    if (!recording?.hasRecording) {
      setMediaUri(null);
      return;
    }
    let cancelled = false;
    recordingService
      .downloadRecordingMedia(recordingId, recording.recordingType)
      .then(uri => {
        if (!cancelled) setMediaUri(uri);
      })
      .catch(err => logRecordingError('RecordingDetailScreen.downloadMedia', err));
    return () => {
      cancelled = true;
    };
  }, [recording?.hasRecording, recording?.recordingType, recordingId]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View className='flex-1 bg-primary-bg'>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppHeader absolute={false}>
          <HeaderBackButton
            liquidGlass
            accessibilityLabel='Back to Recordings'
            iconColor={foregroundColor}
            onPress={() => router.back()}
          />

          {recording &&
            (isEditingTitle ? (
              <View className='flex-row items-center gap-3'>
                <Pressable hitSlop={8} onPress={() => void handleSaveTitle()}>
                  <Check size={18} color='#6366f1' />
                </Pressable>
                <Pressable hitSlop={8} onPress={handleCancelEdit}>
                  <X size={18} color={mutedColor} />
                </Pressable>
              </View>
            ) : (
              <Pressable hitSlop={8} onPress={handleEditTitle}>
                <Pencil size={18} color={mutedColor} />
              </Pressable>
            ))}
        </AppHeader>

        <KeyboardAvoidingView
          className='flex-1'
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View
            className='flex-1 overflow-hidden bg-card pt-2'
            style={{
              borderTopLeftRadius: SHEET_TOP_RADIUS,
              borderTopRightRadius: SHEET_TOP_RADIUS,
            }}
          >
            {isLoading ? (
              <View className='flex-1 items-center justify-center'>
                <ActivityIndicator size='large' />
              </View>
            ) : error ? (
              <View className='flex-1 items-center justify-center px-8 gap-3'>
                <Text className='text-sm text-center' style={{ color: mutedColor }}>
                  {error}
                </Text>
                <Pressable
                  onPress={() => void loadRecording(recordingId)}
                  className='px-4 py-2 rounded-xl bg-indigo-500 active:opacity-70'
                >
                  <Text className='text-sm font-medium text-white'>Try again</Text>
                </Pressable>
              </View>
            ) : recording ? (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ padding: 16, gap: 16 }}
              >
                {/* ── Title ── */}
                {isEditingTitle ? (
                  <TextInput
                    ref={titleInputRef}
                    value={editedTitle}
                    onChangeText={setEditedTitle}
                    returnKeyType='done'
                    onSubmitEditing={() => void handleSaveTitle()}
                    className='text-2xl font-bold'
                    style={{ color: foregroundColor }}
                  />
                ) : (
                  <Text className='text-2xl font-bold' style={{ color: foregroundColor }}>
                    {recording.title || 'Recording'}
                  </Text>
                )}

                {/* ── Metadata ── */}
                <View className='flex-row items-center gap-2 flex-wrap -mt-2'>
                  <Clock size={13} color={mutedColor} />
                  <Text className='text-sm' style={{ color: mutedColor }}>
                    {formatRelativeTime(recording.startedAt)}
                  </Text>
                  {recording.durationMs !== null && (
                    <>
                      <Text className='text-sm' style={{ color: mutedColor }}>
                        ·
                      </Text>
                      <Text className='text-sm' style={{ color: mutedColor }}>
                        {'Duration: '}
                        {formatRecordingDuration(recording.durationMs)}
                      </Text>
                    </>
                  )}
                </View>

                {/* ── Action buttons ── */}
                <View className='flex-row gap-3'>
                  <ActionButton
                    icon={
                      <Share2
                        size={18}
                        color={recording.hasRecording ? foregroundColor : mutedColor}
                      />
                    }
                    label='Share Recording'
                    onPress={handleShare}
                    disabled={!recording.hasRecording}
                  />
                  <ActionButton
                    icon={<Trash2 size={18} color='#EF4444' />}
                    label='Delete Recording'
                    onPress={handleDelete}
                    disabled={isDeleting}
                    loading={isDeleting}
                    danger
                  />
                </View>

                {/* ── Player ── */}
                {mediaUri && (
                  <RecordingPlayer uri={mediaUri} recordingType={recording.recordingType} />
                )}

                {/* ── Transcript ── */}
                {recording.hasTranscript && (
                  <SectionCard icon={<FileText size={16} color='#3B82F6' />} title='Transcript'>
                    <TranscriptView
                      plain={recording.transcript}
                      identified={recording.identifiedTranscript}
                      hasIdentified={recording.hasIdentifiedTranscript}
                    />
                  </SectionCard>
                )}

                {/* ── AI Summary ── */}
                {recording.hasSummary && (
                  <View className='pb-8'>
                    <SectionCard icon={<Sparkles size={16} color='#8B5CF6' />} title='AI Summary'>
                      <AiSummaryView summary={recording.aiSummary} />
                    </SectionCard>
                  </View>
                )}

                {/* Empty state */}
                {!recording.hasTranscript && !recording.hasSummary && (
                  <View className='rounded-2xl p-4' style={{ borderWidth: 1, borderColor }}>
                    <Text className='text-sm italic text-center' style={{ color: mutedColor }}>
                      No transcript or summary available yet.
                    </Text>
                  </View>
                )}
              </ScrollView>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <AppBottomSheet
        isOpen={showShareSheet}
        onOpenChange={open => !open && setShowShareSheet(false)}
        mode='fullscreen'
        keyboardBehavior='extend'
      >
        {recording && (
          <ShareRecordingSheet
            callId={recording.externalId}
            isOpen={showShareSheet}
            onClose={() => setShowShareSheet(false)}
          />
        )}
      </AppBottomSheet>
    </View>
  );
}
