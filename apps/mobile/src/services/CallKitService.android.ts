import RNCallKeep from 'react-native-callkeep';

import type {
  CallEndReason,
  CallKitCallType,
  CallKitEventHandlers,
  CallKitPayload,
  RingingCall,
} from './CallKit.types';
import { CALL_RING_TIMEOUT_MS } from './PushNotificationPayload';

/**
 * react-native-callkeep's Android reason codes (VoiceConnection.reportDisconnect).
 * UNANSWERED maps to MISSED (6) so Telecom logs a missed call rather than BUSY.
 */
const END_CALL_REASON_CODES: Record<CallEndReason, number> = {
  FAILED: 1,
  REMOTE_ENDED: 2,
  UNANSWERED: 6,
  ANSWERED_ELSEWHERE: 4,
  DECLINED_ELSEWHERE: 2,
};

class CallKitService {
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private sessionActive = false;
  private lifecycleGeneration = 0;
  private eventHandlers: CallKitEventHandlers = {};
  private callPayloads = new Map<string, CallKitPayload>();
  private callKeepDisplayedUUIDs = new Set<string>();
  /** When each CallKeep connection was displayed, keyed by UUID. */
  private displayedAt = new Map<string, number>();
  /** UUIDs answered on this device (CallKeep answer event or app-side connect). */
  private answeredUUIDs = new Set<string>();
  /** Ring timeouts for CallKeep connections we displayed, keyed by UUID. */
  private ringTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private activeCallUUID: string | null = null;

  private async logPhoneAccountState(context: string): Promise<void> {
    const callKeep = RNCallKeep as unknown as {
      hasPhoneAccount?: () => Promise<boolean>;
    };
    try {
      const enabled = await RNCallKeep.checkPhoneAccountEnabled();
      const hasPhoneAccount =
        typeof callKeep.hasPhoneAccount === 'function'
          ? await callKeep.hasPhoneAccount()
          : undefined;
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Android] phone account state', {
        context,
        enabled,
        hasPhoneAccount,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[CallKeep][Android] failed to read phone account state', { context, error });
    }
  }

  async initialize(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[CallKeep][Debug] initialize called', {
      initialized: this.initialized,
      hasInitializingPromise: !!this.initializing,
    });

    // Return existing promise if initialization is in progress
    if (this.initializing) {
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Debug] initialize: waiting for existing initialization...');
      return this.initializing;
    }

    if (this.initialized) {
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Debug] initialize: already initialized, skipping');
      return;
    }

    // Create initialization promise to prevent concurrent calls
    this.initializing = this.doInitialize();
    return this.initializing;
  }

  private async doInitialize(): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[CallKeep][Debug] doInitialize started');

    try {
      await RNCallKeep.setup({
        ios: {
          appName: 'Lotus',
        },
        android: {
          alertTitle: 'Permissions required',
          alertDescription: 'Lotus needs access to your phone account',
          cancelButton: 'Cancel',
          okButton: 'OK',
          additionalPermissions: [],
          // RNCallKeep's JS wrapper skips its phone-account alert only in self-managed setup.
          // We restore persisted settings below so normal CallKeep calls keep the existing mode.
          selfManaged: true,
        },
      });
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Debug] RNCallKeep.setup() completed');
    } catch (setupError) {
      // User cancelled the Phone Account dialog or setup failed
      // This is expected behavior on first launch - we'll continue without CallKit
      // and the phone account can be enabled later from settings
      // eslint-disable-next-line no-console
      console.log(
        '[CallKeep][Debug] RNCallKeep.setup() cancelled or failed (expected on first launch)',
        {
          error: setupError instanceof Error ? setupError.message : 'User cancelled',
        },
      );
      // Still mark as initialized so the app can continue
      // Phone account can be enabled later and calls will still work via notifications
      this.initialized = true;
      this.initializing = null;
      return;
    }
    // eslint-disable-next-line no-console
    console.log('[CallKeep][Debug] RNCallKeep.setup() completed');

    const callKeep = RNCallKeep as unknown as {
      setSettings?: (settings: {
        android: {
          alertTitle: string;
          alertDescription: string;
          cancelButton: string;
          okButton: string;
          additionalPermissions: string[];
          selfManaged: boolean;
        };
        ios: { appName: string };
      }) => void;
    };
    callKeep.setSettings?.({
      android: {
        alertTitle: 'Permissions required',
        alertDescription: 'Lotus needs access to your phone account',
        cancelButton: 'Cancel',
        okButton: 'OK',
        additionalPermissions: [],
        selfManaged: false,
      },
      ios: { appName: 'Lotus' },
    });

    RNCallKeep.addEventListener('didDisplayIncomingCall', event => {
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Android] didDisplayIncomingCall', event);
    });
    RNCallKeep.addEventListener('createIncomingConnectionFailed', event => {
      // eslint-disable-next-line no-console
      console.warn('[CallKeep][Android] createIncomingConnectionFailed', event);
    });
    RNCallKeep.addEventListener('showIncomingCallUi', event => {
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Android] showIncomingCallUi', event);
    });

    RNCallKeep.addEventListener('answerCall', ({ callUUID }) => {
      if (!this.sessionActive) return;
      this.answeredUUIDs.add(callUUID);
      this.clearRingTimeout(callUUID);
      const payload = this.callPayloads.get(callUUID);
      this.eventHandlers.onAnswerCall?.(callUUID, payload);
    });

    RNCallKeep.addEventListener('endCall', ({ callUUID }) => {
      if (!this.sessionActive) return;
      const payload = this.callPayloads.get(callUUID);
      this.eventHandlers.onEndCall?.(callUUID, payload);
      this.forgetCall(callUUID);
    });

    // eslint-disable-next-line no-console
    console.log('[CallKeep][Debug] Checking phone account state after setup...');
    try {
      const hasPhoneAccount = await RNCallKeep.checkPhoneAccountEnabled();
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Debug] Phone account enabled:', hasPhoneAccount);
      if (!hasPhoneAccount) {
        // eslint-disable-next-line no-console
        console.log(
          '[CallKeep][Android] Phone account disabled. Continuing without settings prompt.',
        );
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[CallKeep][Android] Failed to verify phone account state', error);
    }
    await this.logPhoneAccountState('initialize');

    this.initialized = true;
    this.initializing = null;
    // eslint-disable-next-line no-console
    console.log('[CallKeep][Debug] doInitialize completed, initialized set to true');
  }

  setEventHandlers(handlers: CallKitEventHandlers): void {
    this.lifecycleGeneration += 1;
    this.sessionActive = true;
    this.eventHandlers = handlers;
  }

  /** Retire payload/timer state and dismiss tracked Telecom calls on logout. */
  clearSessionState(): void {
    this.lifecycleGeneration += 1;
    this.sessionActive = false;
    for (const callUUID of this.callKeepDisplayedUUIDs) {
      try {
        // Use the remote-ended path so cleanup does not synthesize an
        // endCall callback that could enqueue a decline for the next user.
        RNCallKeep.reportEndCallWithUUID(callUUID, END_CALL_REASON_CODES.REMOTE_ENDED);
      } catch {
        // Best effort: the bookkeeping is still retired below.
      }
    }
    for (const timer of this.ringTimeouts.values()) {
      clearTimeout(timer);
    }
    this.ringTimeouts.clear();
    this.callPayloads.clear();
    this.callKeepDisplayedUUIDs.clear();
    this.answeredUUIDs.clear();
    this.activeCallUUID = null;
    this.eventHandlers = {};
  }

  /** Android has no separate native pending-payload store. */
  clearPendingNativeState(): Promise<void> {
    return Promise.resolve();
  }

  bringToForeground(): void {
    const callKeep = RNCallKeep as unknown as { backToForeground?: () => void };
    if (typeof callKeep.backToForeground === 'function') {
      callKeep.backToForeground();
    }
  }

  cacheIncomingCallPayload(payload: CallKitPayload): void {
    if (!this.sessionActive) return;
    const callUUID = payload.callUUID || payload.callId;
    this.callPayloads.set(callUUID, {
      ...payload,
      callUUID,
    });
    this.activeCallUUID = callUUID;
  }

  getCallPayload(callUUID: string): CallKitPayload | undefined {
    return this.callPayloads.get(callUUID);
  }

  /** Look up the CallKit UUID for a given backend callId. */
  getCallUUIDByCallId(callId: string): string | undefined {
    for (const [uuid, payload] of this.callPayloads.entries()) {
      if (payload.callId === callId) return uuid;
    }
    return undefined;
  }

  /** On Android JS picks the CallKeep UUID itself, so an unknown callId is its own UUID. */
  resolveCallKitUUID(idOrUUID: string): string {
    if (this.callPayloads.has(idOrUUID)) {
      return idOrUUID;
    }
    return this.getCallUUIDByCallId(idOrUUID) ?? idOrUUID;
  }

  /** Android has no system call list to reconcile against; native owns the ring UI. */
  async reconcileWithSystemCalls(): Promise<void> {}

  /** iOS-only: indexes CallKit's queued display events. */
  async indexQueuedDisplayedCalls(): Promise<void> {}

  async displayIncomingCall(payload: CallKitPayload): Promise<void> {
    if (!this.sessionActive) return;
    const generation = this.lifecycleGeneration;
    // eslint-disable-next-line no-console
    console.log('[CallKeep][Debug] displayIncomingCall called', {
      initialized: this.initialized,
      callId: payload.callId,
    });
    if (!this.initialized) {
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Debug] displayIncomingCall: not initialized, calling initialize()');
      await this.initialize();
      if (!this.sessionActive || generation !== this.lifecycleGeneration) return;
    }

    const callUUID = payload.callUUID || payload.callId;
    const handle = payload.callId;

    this.callPayloads.set(callUUID, {
      ...payload,
      callUUID,
    });
    this.activeCallUUID = callUUID;

    // eslint-disable-next-line no-console
    console.log('[CallKeep][Debug] displayIncomingCall: checking phone account state...');
    try {
      const hasPhoneAccount = await RNCallKeep.checkPhoneAccountEnabled();
      if (!this.sessionActive || generation !== this.lifecycleGeneration) return;
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Debug] displayIncomingCall: phone account enabled:', hasPhoneAccount);
      if (!hasPhoneAccount) {
        // eslint-disable-next-line no-console
        console.log('[CallKeep][Android] Phone account disabled before displayIncomingCall', {
          callUUID,
        });
      }

      RNCallKeep.displayIncomingCall(
        callUUID,
        handle,
        payload.callerName,
        'generic',
        payload.callType === 'VIDEO',
      );
      this.callKeepDisplayedUUIDs.add(callUUID);
      this.displayedAt.set(callUUID, Date.now());
      this.startRingTimeout(callUUID);
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Android] displayIncomingCall invoked', {
        callUUID,
        handle,
      });
      await this.logPhoneAccountState('displayIncomingCall');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[CallKeep][Android] displayIncomingCall failed', {
        callUUID,
        error,
      });
    }
  }

  async startOutgoingCall(
    _callUUID: string,
    _displayName: string,
    _callType: CallKitCallType,
  ): Promise<void> {
    // roomMachine and LiveKit own outgoing calls, matching dashboard behavior.
    // Starting an Android Telecom call here creates a duplicate connection.
  }

  reportCallConnected(callUUID?: string): void {
    const effectiveUUID = callUUID || this.activeCallUUID;
    if (!effectiveUUID) {
      return;
    }
    this.answeredUUIDs.add(effectiveUUID);
    this.clearRingTimeout(effectiveUUID);
    if (!this.callKeepDisplayedUUIDs.has(effectiveUUID)) {
      return;
    }
    try {
      RNCallKeep.setCurrentCallActive(effectiveUUID);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[CallKeep][Android] RNCallKeep.setCurrentCallActive failed', {
        effectiveUUID,
        error,
      });
    }
  }

  /**
   * Local user action (End / Decline in the app). Goes through CallKeep's
   * endCall, which loops back an `endCall` event → onEndCall.
   */
  async endCall(callUUID?: string): Promise<void> {
    const effectiveUUID = callUUID || this.activeCallUUID;
    if (!effectiveUUID) {
      return;
    }

    if (this.callKeepDisplayedUUIDs.has(effectiveUUID)) {
      try {
        RNCallKeep.endCall(effectiveUUID);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[CallKeep][Android] RNCallKeep.endCall failed', { effectiveUUID, error });
      }
    }
    this.forgetCall(effectiveUUID);
  }

  /** The CallKit UUID of the currently ringing or active call, or null. */
  getActiveCallUUID(): string | null {
    return this.activeCallUUID;
  }

  /** CallKeep connections displayed and not answered on this device. */
  getRingingCalls(): RingingCall[] {
    const ringing: RingingCall[] = [];
    for (const callUUID of this.callKeepDisplayedUUIDs) {
      if (this.answeredUUIDs.has(callUUID)) continue;
      const payload = this.callPayloads.get(callUUID);
      if (!payload) continue;
      ringing.push({
        callId: payload.callId,
        callUUID,
        displayedAt: this.displayedAt.get(callUUID) ?? 0,
      });
    }
    return ringing;
  }

  /**
   * Remote dismissal (CALL_DISMISS / MISSED_CALL, remote hang-up, ring timeout).
   * Uses reportEndCallWithUUID so Telecom drops the connection with the typed
   * DisconnectCause and — unlike endCall — no `endCall` event loops back into
   * a spurious declineCall() API call.
   */
  reportCallEnded(callUUID: string, reason: CallEndReason): void {
    const effectiveUUID = this.resolveCallKitUUID(callUUID);
    if (this.callKeepDisplayedUUIDs.has(effectiveUUID)) {
      try {
        RNCallKeep.reportEndCallWithUUID(effectiveUUID, END_CALL_REASON_CODES[reason]);
        // eslint-disable-next-line no-console
        console.log('[CallKeep][Android] reportEndCallWithUUID', { effectiveUUID, reason });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[CallKeep][Android] RNCallKeep.reportEndCallWithUUID failed', {
          effectiveUUID,
          reason,
          error,
        });
      }
    }
    this.forgetCall(effectiveUUID);
  }

  /**
   * CallKeep connections are ended here after CALL_RING_TIMEOUT_MS; the native
   * CallStyle notification and full-screen activity time out on their own.
   */
  private startRingTimeout(callUUID: string): void {
    this.clearRingTimeout(callUUID);
    const timer = setTimeout(() => {
      this.ringTimeouts.delete(callUUID);
      if (this.answeredUUIDs.has(callUUID) || !this.callKeepDisplayedUUIDs.has(callUUID)) {
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[CallKeep][Android] ring timeout — reporting missed', { callUUID });
      this.reportCallEnded(callUUID, 'UNANSWERED');
    }, CALL_RING_TIMEOUT_MS);
    this.ringTimeouts.set(callUUID, timer);
  }

  private clearRingTimeout(callUUID: string): void {
    const timer = this.ringTimeouts.get(callUUID);
    if (timer) {
      clearTimeout(timer);
      this.ringTimeouts.delete(callUUID);
    }
  }

  private forgetCall(callUUID: string): void {
    this.clearRingTimeout(callUUID);
    this.callKeepDisplayedUUIDs.delete(callUUID);
    this.displayedAt.delete(callUUID);
    this.callPayloads.delete(callUUID);
    this.answeredUUIDs.delete(callUUID);
    if (this.activeCallUUID === callUUID) {
      this.activeCallUUID = null;
    }
  }
}

export const callKitService = new CallKitService();
