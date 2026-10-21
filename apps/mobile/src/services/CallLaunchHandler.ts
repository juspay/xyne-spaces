import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CallKitPayload } from './CallKit.types';
import { callService } from './Call/callService';
import { CallType } from '@xyne/shared';
import {
  clearPendingCallActionForSession,
  getCallLaunchLifecycleGeneration,
  getCallLaunchSessionMarker,
  invalidateCallLaunchSession,
  isCurrentCallLaunchLifecycle,
  pendingCallActionKey,
} from './callLaunchLifecycle';

interface LaunchCallIntent {
  callId: string;
  callerName: string;
  callType: CallType;
  callAction: 'answer' | 'decline';
  fromBackgroundNotification: boolean;
  channelId?: string;
  autoJoinCall?: boolean;
  autoDeclineCall?: boolean;
  sessionMarker: number;
}

type CallActionType = 'answer' | 'decline' | 'autoJoin' | 'autoDecline';

type CallActionListener = (action: { type: CallActionType; payload: CallKitPayload }) => void;

/**
 * Handles call actions from background notification launches.
 * When the app is killed and user taps Answer/Decline on a notification,
 * the native code launches the app with intent extras that need to be processed.
 */
class CallLaunchHandler {
  private handled = false;
  private listeners: CallActionListener[] = [];

  /**
   * Subscribe to call actions from background notifications.
   * This is used by the CanvasWebViewScreen to handle call actions.
   */
  subscribe(listener: CallActionListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notify all listeners of a call action.
   */
  private notifyListeners(action: { type: CallActionType; payload: CallKitPayload }): void {
    this.listeners.forEach(listener => {
      try {
        listener(action);
      } catch (error) {
        console.error('[CallLaunchHandler] Listener error:', error);
      }
    });
  }

  /**
   * Parse and store the launch intent when the app starts.
   * This should be called early in the app lifecycle before navigation.
   */
  async captureLaunchIntent(): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }

    const generation = getCallLaunchLifecycleGeneration();
    const sessionMarker = getCallLaunchSessionMarker();
    if (sessionMarker === null) {
      return;
    }

    try {
      // Native module will be used to get the initial intent
      const intent = await this.getInitialIntent();
      if (!isCurrentCallLaunchLifecycle(generation) || !intent) {
        return;
      }

      // Check if this is a call action from background notification
      if (!intent.extras?.['fromBackgroundNotification']) {
        return;
      }

      const callAction = intent.extras['callAction'];
      const callId = intent.extras['callId'];

      if (!callAction || !callId) {
        console.warn('[CallLaunchHandler] Missing callAction or callId in launch intent');
        return;
      }

      // Store the pending action for processing after auth is ready
      const launchIntent: LaunchCallIntent = {
        callId: String(callId),
        callerName: String(intent.extras['callerName'] || 'Unknown Caller'),
        callType: intent.extras['callType'] === 'VIDEO' ? CallType.VIDEO : CallType.AUDIO,
        callAction: callAction === 'decline' ? 'decline' : 'answer',
        fromBackgroundNotification: true,
        sessionMarker,
      };

      const channelIdValue = intent.extras['channelId'];
      if (channelIdValue) {
        launchIntent.channelId = String(channelIdValue);
      }

      // Capture auto-join/decline flags from notification actions
      // When callAction is 'answer', we should auto-join the call
      if (launchIntent.callAction === 'answer') {
        launchIntent.autoJoinCall = true;
      }
      // When callAction is 'decline', we should auto-decline the call
      if (launchIntent.callAction === 'decline') {
        launchIntent.autoDeclineCall = true;
      }

      // Also check explicit flags if provided
      const autoJoinCall = intent.extras['autoJoinCall'];
      if (autoJoinCall === true || autoJoinCall === 'true') {
        launchIntent.autoJoinCall = true;
      }

      const autoDeclineCall = intent.extras['autoDeclineCall'];
      if (autoDeclineCall === true || autoDeclineCall === 'true') {
        launchIntent.autoDeclineCall = true;
      }

      await AsyncStorage.setItem(pendingCallActionKey(sessionMarker), JSON.stringify(launchIntent));
      if (
        !isCurrentCallLaunchLifecycle(generation) ||
        getCallLaunchSessionMarker() !== sessionMarker
      ) {
        return;
      }
      this.handled = false;
      console.log('[CallLaunchHandler] Captured launch intent:', {
        callAction,
        callId,
        autoJoinCall: launchIntent.autoJoinCall,
        autoDeclineCall: launchIntent.autoDeclineCall,
      });
    } catch (error) {
      console.error('[CallLaunchHandler] Failed to capture launch intent:', error);
    }
  }

  /**
   * Process any pending call action from a background notification launch.
   * This notifies listeners (like CanvasWebViewScreen) to handle the call action.
   */
  async processPendingCallAction(): Promise<void> {
    if (this.handled) {
      return;
    }

    const generation = getCallLaunchLifecycleGeneration();
    const sessionMarker = getCallLaunchSessionMarker();
    if (sessionMarker === null) {
      this.handled = true;
      return;
    }

    try {
      const pendingJson = await AsyncStorage.getItem(pendingCallActionKey(sessionMarker));
      if (!isCurrentCallLaunchLifecycle(generation) || !pendingJson) {
        return;
      }

      let launchIntent: LaunchCallIntent;
      try {
        launchIntent = JSON.parse(pendingJson) as LaunchCallIntent;
      } catch {
        // Do not remove asynchronously after a malformed read: a fresh launch
        // action could have replaced this value while the read was in flight.
        this.handled = true;
        return;
      }
      if (
        !isCurrentCallLaunchLifecycle(generation) ||
        getCallLaunchSessionMarker() !== sessionMarker ||
        launchIntent.sessionMarker !== sessionMarker
      ) {
        this.handled = true;
        return;
      }

      // Clear the pending action immediately to prevent duplicate processing
      await AsyncStorage.removeItem(pendingCallActionKey(sessionMarker));
      if (!isCurrentCallLaunchLifecycle(generation)) {
        return;
      }
      this.handled = true;

      // Build the CallKit payload
      const payload: CallKitPayload = {
        callId: launchIntent.callId,
        callUUID: launchIntent.callId,
        callerName: launchIntent.callerName,
        callType: launchIntent.callType,
        ...(launchIntent.channelId ? { channelId: launchIntent.channelId } : {}),
      };

      if (launchIntent.callAction === 'answer') {
        // If autoJoinCall flag is set, emit autoJoin event for direct call navigation
        if (!isCurrentCallLaunchLifecycle(generation)) {
          return;
        }
        if (launchIntent.autoJoinCall) {
          this.notifyListeners({ type: 'autoJoin', payload });
        } else {
          // Notify listeners (CanvasWebViewScreen) to handle the answer action
          this.notifyListeners({ type: 'answer', payload });
        }

        // Also join the call via API to get credentials if not provided
        if (!payload.token || !payload.serverUrl) {
          try {
            const credentials = await callService.joinCall({ callId: payload.callId });
            if (!isCurrentCallLaunchLifecycle(generation)) {
              return;
            }
            // Update payload with credentials
            payload.token = credentials.token;
            payload.serverUrl = credentials.livekitUrl;
            // Notify again with updated credentials
            if (launchIntent.autoJoinCall) {
              this.notifyListeners({ type: 'autoJoin', payload });
            } else {
              this.notifyListeners({ type: 'answer', payload });
            }
          } catch (error) {
            console.error('[CallLaunchHandler] Failed to get call credentials:', error);
          }
        }
      } else if (launchIntent.callAction === 'decline') {
        // Handle decline action
        try {
          await callService.declineCall(launchIntent.callId);
          if (!isCurrentCallLaunchLifecycle(generation)) {
            return;
          }
          if (launchIntent.autoDeclineCall) {
            this.notifyListeners({ type: 'autoDecline', payload });
          } else {
            this.notifyListeners({ type: 'decline', payload });
          }
        } catch (error) {
          console.error('[CallLaunchHandler] Failed to decline call:', error);
        }
      }
    } catch (error) {
      console.error('[CallLaunchHandler] Failed to process pending call action:', error);
    }
  }

  /**
   * Remove a captured notification action when the auth session ends. The
   * action is user/session-scoped even though it lives in AsyncStorage, so it
   * must not survive logout or account replacement.
   */
  async clearPendingCallAction(): Promise<void> {
    this.handled = true;
    this.listeners = [];
    await clearPendingCallActionForSession(getCallLaunchLifecycleGeneration());
  }

  /**
   * Get the initial launch intent from native.
   * This uses a native module to access the intent that launched the app.
   */
  private async getInitialIntent(): Promise<{ extras?: Record<string, unknown> } | null> {
    try {
      // Try to get the initial intent from the app's Activity
      // This requires a native module that can access the current Activity's intent
      const { NativeModules } = await import('react-native');

      // Try LotusLaunchIntentModule first (our custom module)
      const launchModule = NativeModules['LotusLaunchIntentModule'];
      if (launchModule?.getLaunchIntent) {
        try {
          const intent = await launchModule.getLaunchIntent();
          if (intent?.extras) {
            console.log(
              '[CallLaunchHandler] Got intent from LotusLaunchIntentModule:',
              intent.extras,
            );
            return intent;
          }
        } catch (moduleError) {
          console.warn('[CallLaunchHandler] LotusLaunchIntentModule error:', moduleError);
        }
      }

      // Fallback: Try to use RNCallKeep's launch data
      try {
        const RNCallKeep = await import('react-native-callkeep').then(m => m.default);
        const callKeep = RNCallKeep as unknown as {
          getLaunchData?: () => Promise<{ extras?: Record<string, unknown> } | null>;
          _launchData?: { extras?: Record<string, unknown> };
        };

        if (typeof callKeep.getLaunchData === 'function') {
          const launchData = await callKeep.getLaunchData();
          if (launchData?.extras) {
            console.log(
              '[CallLaunchHandler] Got intent from CallKeep getLaunchData:',
              launchData.extras,
            );
            return launchData;
          }
        }

        if (callKeep._launchData?.extras) {
          console.log(
            '[CallLaunchHandler] Got intent from CallKeep _launchData:',
            callKeep._launchData.extras,
          );
          return callKeep._launchData;
        }
      } catch (callKeepError) {
        console.warn('[CallLaunchHandler] CallKeep error:', callKeepError);
      }

      console.log('[CallLaunchHandler] No launch intent found from any source');
      return null;
    } catch (error) {
      console.error('[CallLaunchHandler] Error getting initial intent:', error);
      return null;
    }
  }

  /**
   * Reset the handler state. Call this when user signs out.
   */
  reset(): void {
    invalidateCallLaunchSession();
    this.handled = true;
    this.listeners = [];
  }
}

export const callLaunchHandler = new CallLaunchHandler();
