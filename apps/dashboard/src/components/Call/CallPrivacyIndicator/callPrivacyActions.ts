import { Bot, CircleDot, Mic, Monitor } from 'lucide-react';
import { RecordingType } from '@xyne/shared';

export type CallPrivacyActionTone = 'ai' | 'recording';

export interface CallPrivacyAction {
  id: string;
  title: string;
  description: string;
  Icon: typeof Mic;
  tone: CallPrivacyActionTone;
  statusLabel?: string | undefined;
}

interface RecordingModeAction {
  title: string;
  description: string;
  Icon: typeof Mic;
}

interface CreateCallPrivacyActionsParams {
  isRecordingActive: boolean;
  recordingType?: string | null | undefined;
  recordingElapsed: string;
  recordingStartedByName?: string | null | undefined;
}

function getRecordingModeAction(recordingType?: string | null): RecordingModeAction {
  switch (recordingType) {
    case RecordingType.AUDIO_ONLY:
      return {
        title: 'Voice only',
        description: 'Recording participant audio and transcript.',
        Icon: Mic,
      };
    case RecordingType.AUDIO_SCREEN:
      return {
        title: 'Screen + voice',
        description: 'Recording screen share, audio, and transcript.',
        Icon: Monitor,
      };
    default:
      return {
        title: 'Recording',
        description: 'This call is being recorded.',
        Icon: CircleDot,
      };
  }
}

export function createCallPrivacyActions({
  isRecordingActive,
  recordingType,
  recordingElapsed,
  recordingStartedByName,
}: CreateCallPrivacyActionsParams): CallPrivacyAction[] {
  const actions: CallPrivacyAction[] = [
    {
      id: 'transcribing',
      title: 'Transcribing',
      description: 'Live transcript',
      Icon: Bot,
      tone: 'ai',
    },
  ];

  if (isRecordingActive) {
    const recordingMode = getRecordingModeAction(recordingType);
    actions.push({
      id: `recording-${recordingType ?? 'unknown'}`,
      title: recordingMode.title,
      description: `${recordingMode.description}${
        recordingStartedByName ? ` Started by ${recordingStartedByName}.` : ''
      }`,
      Icon: recordingMode.Icon,
      tone: 'recording',
      statusLabel: recordingElapsed,
    });
  }

  return actions;
}
