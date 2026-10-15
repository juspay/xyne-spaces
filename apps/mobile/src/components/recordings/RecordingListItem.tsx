// ---------------------------------------------------------------------------
// RecordingListItem
// A single row in the recordings list.
// ---------------------------------------------------------------------------

import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Mic, ChevronRight, FileText, Sparkles } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import type { Recording } from '@/src/types/recordings';
import { formatRecordingDuration } from '@/src/utils/recordingUtils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeDate(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RecordingListItemProps {
  recording: Recording;
  onPress: (recording: Recording) => void;
}

export function RecordingListItem({ recording, onPress }: RecordingListItemProps): ReactElement {
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const borderColor = useCSSVariable('--color-border') as string;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Recording: ${recording.title}`}
      onPress={() => onPress(recording)}
      className='active:opacity-70'
    >
      <View
        className='flex-row items-center gap-3 px-4 py-3'
        style={{ borderBottomWidth: 1, borderBottomColor: borderColor }}
      >
        {/* Mic icon */}
        <View className='size-10 rounded-full bg-indigo-500/15 items-center justify-center flex-shrink-0'>
          <Mic size={18} color='#6366f1' />
        </View>

        {/* Content */}
        <View className='flex-1 gap-0.5'>
          <Text
            className='text-sm font-semibold text-foreground'
            numberOfLines={1}
            style={{ color: foregroundColor }}
          >
            {recording.title || 'Untitled Recording'}
          </Text>

          <View className='flex-row items-center gap-2'>
            <Text className='text-xs text-secondary-foreground' style={{ color: mutedColor }}>
              {formatRelativeDate(recording.startedAt)}
            </Text>

            {recording.durationMs != null && (
              <>
                <Text className='text-xs text-secondary-foreground' style={{ color: mutedColor }}>
                  ·
                </Text>
                <Text className='text-xs text-secondary-foreground' style={{ color: mutedColor }}>
                  {formatRecordingDuration(recording.durationMs)}
                </Text>
              </>
            )}
          </View>

          {/* Badges */}
          <View className='flex-row items-center gap-2 mt-1 flex-wrap'>
            {recording.hasTranscript && (
              <View className='flex-row items-center gap-1 bg-blue-500/15 rounded-full px-2 py-0.5'>
                <FileText size={10} color='#3B82F6' />
                <Text className='text-[10px] font-medium' style={{ color: '#3B82F6' }}>
                  Transcript
                </Text>
              </View>
            )}

            {recording.hasSummary && (
              <View className='flex-row items-center gap-1 bg-violet-500/15 rounded-full px-2 py-0.5'>
                <Sparkles size={10} color='#8B5CF6' />
                <Text className='text-[10px] font-medium' style={{ color: '#8B5CF6' }}>
                  AI Summary
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Chevron */}
        <ChevronRight size={16} color={mutedColor} />
      </View>
    </Pressable>
  );
}
