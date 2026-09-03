import type { SdlcCallLink } from '@xyne/shared';
import { CallType } from '@xyne/shared';
import { toast } from 'sonner';
import { isCallWindow, isElectronApp, openCallWindow } from '../../utils/electronApp';
import { isCallWindowActive } from '../../utils/callWindowChannel';
import { isNativeCallSupported } from '../../utils/reactNativeBridge';
import { logger } from '../../utils/logger';

export const NEW_CALL_ID = 'new';

export const readActiveWorkspaceId = (paramWorkspaceId?: string): string | null => {
  if (paramWorkspaceId) return paramWorkspaceId;
  try {
    const email = logger.emailId || localStorage.getItem('user_email');
    if (!email) return null;
    return localStorage.getItem(`lastActiveWorkspaceId_${email}`);
  } catch {
    return null;
  }
};

export const readTheme = (): string | null => {
  try {
    return localStorage.getItem('xyne-theme');
  } catch {
    return null;
  }
};

export const shouldUseCallWindow = (isMobile: boolean): boolean =>
  isElectronApp() && !isMobile && !isNativeCallSupported() && !isCallWindow();

const blockedByLiveCall = (): boolean => {
  if (!isCallWindowActive()) return false;
  toast.error('Leave your current call before starting a new one.');
  return true;
};

export interface InitiateCallWindowParams {
  channelId: string;
  callType?: CallType;
  targetUserIds?: string[] | undefined;
  callDisplayName?: string | undefined;
  conversationId?: string | undefined;
  artifactMessageId?: string | undefined;
  sdlcLink?: SdlcCallLink | undefined;
}

export interface JoinCallWindowOptions {
  callType?: CallType | undefined;
  replaceLiveCall?: boolean | undefined;
}

export const openJoinCallWindow = (callId: string, options?: JoinCallWindowOptions): boolean => {
  if (!options?.replaceLiveCall && blockedByLiveCall()) return false;
  return openCallWindow({
    callId,
    callType: options?.callType ?? CallType.VIDEO,
    stage: 'lobby',
    workspaceId: readActiveWorkspaceId(),
    theme: readTheme(),
  });
};

export const openRingCallWindow = (params: {
  callId: string;
  callType?: CallType | undefined;
  workspaceId: string | null;
}): boolean => {
  if (isCallWindowActive()) return false;
  return openCallWindow({
    callId: params.callId,
    callType: params.callType ?? CallType.VIDEO,
    stage: 'ring',
    workspaceId: params.workspaceId,
    theme: readTheme(),
    inactive: true,
  });
};

export const openInitiateCallWindow = (params: InitiateCallWindowParams): boolean => {
  if (blockedByLiveCall()) return false;
  const extra = new URLSearchParams();
  extra.set('channelId', params.channelId);
  if (params.targetUserIds?.length) extra.set('targetUserIds', params.targetUserIds.join(','));
  if (params.callDisplayName) extra.set('callDisplayName', params.callDisplayName);
  if (params.conversationId) extra.set('conversationId', params.conversationId);
  if (params.artifactMessageId) extra.set('artifactMessageId', params.artifactMessageId);
  if (params.sdlcLink) {
    try {
      extra.set('sdlcLink', JSON.stringify(params.sdlcLink));
    } catch {
      // A link that will not serialise is not worth failing the call over.
    }
  }

  return openCallWindow({
    callId: NEW_CALL_ID,
    callType: params.callType ?? CallType.AUDIO,
    stage: 'lobby',
    workspaceId: readActiveWorkspaceId(),
    theme: readTheme(),
    extraParams: extra,
  });
};
