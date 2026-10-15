import { CallType } from '@xyne/shared';

export type CallKitCallType = CallType;

export interface CallKitPayload {
  callId: string;
  callUUID: string;
  callerName: string;
  callType: CallType;
  channelId?: string;
  token?: string;
  serverUrl?: string;
  /** iOS: CallKit saw another call in progress (SIM, other VoIP, ours) when this one arrived. */
  onAnotherCall?: boolean;
}

/**
 * Why a call ended for a reason other than a local user action. Mirrors
 * CXCallEndedReason; react-native-callkeep maps the codes per platform.
 */
/** An incoming call the system is ringing that nobody has answered on this device. */
export interface RingingCall {
  callId: string;
  callUUID: string;
  /** Epoch ms when the system UI was displayed; 0 when unknown. */
  displayedAt: number;
}

export type CallEndReason =
  'REMOTE_ENDED' | 'ANSWERED_ELSEWHERE' | 'DECLINED_ELSEWHERE' | 'UNANSWERED' | 'FAILED';

export interface CallKitEventHandlers {
  onAnswerCall?: (callUUID: string, payload?: CallKitPayload) => void;
  onEndCall?: (callUUID: string, payload?: CallKitPayload) => void;
  /** iOS: mute toggled from the CallKit / lock-screen UI. */
  onSetMuted?: (callUUID: string, muted: boolean) => void;
  /** iOS: CallKit is showing a new incoming call (first time this UUID is seen). */
  onIncomingCallDisplayed?: (payload: CallKitPayload) => void;
}
