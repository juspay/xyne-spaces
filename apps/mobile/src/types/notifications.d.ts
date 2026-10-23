declare module 'react-native-voip-push-notification' {
  type EventType = 'register' | 'notification' | 'didLoadWithEvents';

  interface VoipPushNotificationStatic {
    addEventListener(type: EventType, handler: (data: unknown) => void): void;
    removeEventListener(type: EventType): void;
    registerVoipToken(): void;
    onVoipNotificationCompleted?(uuid: string): void;
    RNVoipPushRemoteNotificationReceivedEvent?: string;
  }

  const VoipPushNotification: VoipPushNotificationStatic;
  export default VoipPushNotification;
}

declare module 'react-native-callkeep' {
  export interface CallKeepOptions {
    ios?: {
      appName: string;
      includesCallsInRecents?: boolean;
      supportsVideo?: boolean;
      maximumCallGroups?: number;
      maximumCallsPerCallGroup?: number;
    };
    android?: {
      alertTitle?: string;
      alertDescription?: string;
      cancelButton?: string;
      okButton?: string;
      additionalPermissions?: string[];
      foregroundService?: {
        channelId: string;
        channelName: string;
        notificationTitle: string;
        notificationIcon: string;
      };
    };
  }

  export interface CallEvent {
    callUUID: string;
    handle?: string;
    name?: string;
  }

  export interface EndCallEvent {
    callUUID: string;
  }

  export type EventType = 'answerCall' | 'endCall';

  export function setup(options: CallKeepOptions): Promise<void>;
  export function displayIncomingCall(
    uuid: string,
    handle: string,
    name: string,
    handleType?: string,
    hasVideo?: boolean,
  ): Promise<void>;
  export function endCall(uuid: string): void;
  export function setCurrentCallActive(uuid: string): void;
  export function backToForeground(): void;
  export function addEventListener(
    event: EventType,
    handler: (data: CallEvent | EndCallEvent) => void,
  ): void;
}
