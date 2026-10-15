/**
 * CallKit Service — iOS
 *
 * Bridges react-native-callkeep events to the rest of the app so that:
 *   • Answering a call from the lock-screen / CallKit UI opens the native-call
 *     screen and connects to LiveKit.
 *   • Ending a call from the CallKit UI disconnects LiveKit.
 *   • Ending a call from inside the app dismisses the CallKit UI.
 *
 * Identity contract (shared with LotusCallPushRouter in AppDelegate):
 *   The CallKit UUID is always `deriveCallKitUUID(callId)`. Native reports the
 *   ring with that UUID before JS is awake; JS can therefore end it from a
 *   bare callId (CALL_DISMISS with empty maps) and the two sides never drift.
 *   What CallKit actually reported (didDisplayIncomingCall) still wins when we
 *   have it, so a legacy payload with a foreign UUID keeps working.
 *
 * Cold-start flow (app killed → user accepts → iOS re-launches app):
 *   `didLoadWithEvents` fires with both RNCallKeepDidDisplayIncomingCall (payload)
 *   and RNCallKeepPerformAnswerCallAction. We process the display event first to
 *   populate the payload cache, then fire onAnswerCall.
 *
 * Warm-start flow (app in background → user accepts):
 *   `didDisplayIncomingCall` stores the payload in memory.
 *   `answerCall` fires → we look up the payload from memory.
 *
 * Dismissal contract (following Slack/WhatsApp pattern):
 *   Local user action (End button, decline)  → endCall()          → CXEndCallAction
 *   Remote reason (CALL_DISMISS, hang-up)    → reportCallEnded()  → reportEndCallWithUUID
 *
 * Ring lifetime: native ends an unanswered ring after CALL_RING_TIMEOUT_MS
 * (works with JS dead); this service mirrors it so bookkeeping stays honest.
 */

import { NativeModules } from 'react-native';
import RNCallKeep from 'react-native-callkeep';

import type {
  CallEndReason,
  CallKitCallType,
  CallKitEventHandlers,
  CallKitPayload,
  RingingCall,
} from './CallKit.types';
import { deriveCallKitUUID, isSameCallKitUUID } from './CallKitUUID';
import { CALL_RING_TIMEOUT_MS, parseIncomingCallPayload } from './PushNotificationPayload';

// ---------------------------------------------------------------------------
// Native bridge to PendingCallModule (optional; absent in current builds)
// ---------------------------------------------------------------------------

interface IPendingCallModule {
  getStoredPayload(uuid: string): Promise<Record<string, unknown> | null>;
  clearPendingCall(): Promise<void>;
}

const PendingCallModule: IPendingCallModule = (NativeModules['PendingCallModule'] as
  IPendingCallModule | undefined) ?? {
  getStoredPayload: async () => null,
  clearPendingCall: async () => {},
};

/** CXCallEndedReason raw values, as consumed by RNCallKeep.endCallWithUUID:reason:. */
const END_CALL_REASON_CODES: Record<CallEndReason, number> = {
  FAILED: 1,
  REMOTE_ENDED: 2,
  UNANSWERED: 3,
  ANSWERED_ELSEWHERE: 4,
  DECLINED_ELSEWHERE: 5,
};

/** JS mirror fires a little after native so native's UNANSWERED report wins. */
const RING_TIMEOUT_GRACE_MS = 2_000;

interface DidDisplayIncomingCallEvent {
  callUUID: string;
  payload?: object;
  error?: string;
  errorCode?: string;
}

interface SystemCall {
  callUUID: string;
  hasConnected?: boolean;
  hasEnded?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a raw VoIP push payload dict into a CallKitPayload. */
function parsePendingPayload(raw: Record<string, unknown>): CallKitPayload | undefined {
  const parsed = parsePayloadFields(raw);
  // Set by the native push router (LotusCallPushRouter.ringPayload).
  if (parsed && raw['lotusOnAnotherCall'] === true) parsed.onAnotherCall = true;
  return parsed;
}

function parsePayloadFields(raw: Record<string, unknown>): CallKitPayload | undefined {
  // parseIncomingCallPayload handles metadata unwrapping and field extraction.
  // Inject type='INCOMING_CALL' so it isn't rejected if the push doesn't include it.
  // Inject type AFTER the spread so our sentinel overrides any conflicting type field
  const parsed = parseIncomingCallPayload({ ...raw, type: 'INCOMING_CALL' });
  if (parsed) return parsed;

  // Direct fallback when metadata structure differs
  const callId = (raw['callId'] ?? raw['uuid']) as string | undefined;
  if (!callId) return undefined;

  const result: CallKitPayload = {
    callId,
    callUUID: callId,
    callerName: (raw['callerName'] as string) ?? 'Unknown Caller',
    callType:
      (raw['callType'] as string) === 'VIDEO'
        ? ('VIDEO' as CallKitCallType)
        : ('AUDIO' as CallKitCallType),
    channelId: (raw['channelId'] as string) ?? callId,
  };
  const token = raw['token'] as string | undefined;
  const serverUrl = (raw['serverUrl'] ?? raw['liveKitUrl']) as string | undefined;
  if (token) result.token = token;
  if (serverUrl) result.serverUrl = serverUrl;
  return result;
}

// ---------------------------------------------------------------------------
// CallKitService
// ---------------------------------------------------------------------------

/** An event CallKeep queued while no JS listener was attached. */
interface QueuedCallKeepEvent {
  name?: string;
  data?: { callUUID?: unknown; payload?: Record<string, unknown>; errorCode?: string };
}

class CallKitService {
  private isInitialized = false;
  private sessionActive = false;
  private lifecycleGeneration = 0;

  /** The CallKit UUID of the currently answered/active call. */
  private activeCallUUID: string | null = null;

  /**
   * Set while we are programmatically ending a call (to break a potential
   * endCall event → disconnect → endCall loop).
   */
  private endingCallUUID: string | null = null;

  /** Payloads keyed by the CallKit UUID CallKit actually reported. */
  private incomingCallPayloads = new Map<string, CallKitPayload>();

  /** When CallKit displayed each ring, keyed by CallKit UUID. */
  private displayedAt = new Map<string, number>();

  /** Payloads keyed by backend callId (and by resolved UUID) from JS-side push events. */
  private payloadByCallId = new Map<string, CallKitPayload>();

  /** JS mirror of the native ring timeout, keyed by CallKit UUID. */
  private ringTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  /** Handlers registered by the consumer (NativeShell in _layout.tsx). */
  private handlers: CallKitEventHandlers = {};

  /**
   * Cold-start answer queued while handlers weren't set yet.
   * Fired as soon as setEventHandlers() is called.
   */
  private pendingColdStartAnswer: {
    uuid: string;
    payload?: CallKitPayload;
    generation: number;
  } | null = null;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Register RNCallKeep event listeners. Safe to call multiple times. */
  initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.setupEventListeners();
  }

  /**
   * Register answer/end callbacks.
   * If a cold-start answer was detected before handlers were set, it fires immediately.
   */
  setEventHandlers(handlers: CallKitEventHandlers): void {
    this.sessionActive = true;
    this.handlers = handlers;

    if (this.pendingColdStartAnswer) {
      const { uuid, payload, generation } = this.pendingColdStartAnswer;
      this.pendingColdStartAnswer = null;
      // Defer one tick so the caller's useEffect settles before navigation
      setTimeout(() => {
        if (!this.sessionActive || generation !== this.lifecycleGeneration) return;
        this.handlers.onAnswerCall?.(uuid, payload);
      }, 0);
    }
  }

  /**
   * The CallKit UUID for a backend callId (or an already-resolved UUID).
   * Prefers what CallKit reported; otherwise the deterministic derivation
   * shared with native — so this works even when the maps are empty.
   */
  resolveCallKitUUID(idOrUUID: string): string {
    if (this.incomingCallPayloads.has(idOrUUID)) {
      return idOrUUID;
    }
    for (const [uuid, payload] of this.incomingCallPayloads) {
      if (payload.callId === idOrUUID || isSameCallKitUUID(uuid, idOrUUID)) {
        return uuid;
      }
    }
    const cached = this.payloadByCallId.get(idOrUUID);
    if (cached?.callUUID) {
      return cached.callUUID;
    }
    return deriveCallKitUUID(idOrUUID);
  }

  /**
   * Tell CallKit that the call has ended due to a LOCAL user action.
   * (User taps "End" in the app, declines from the in-app modal, etc.)
   * Creates a CXEndCallAction which dismisses the CallKit UI.
   *
   * @param callUUID - CallKit UUID or backend callId. Falls back to activeCallUUID.
   */
  endCall(callUUID?: string): void {
    const raw = callUUID ?? this.activeCallUUID;
    if (!raw) {
      // eslint-disable-next-line no-console
      console.log('[XCALL][KIT] endCall — skipped (no UUID, no active call)');
      return;
    }

    const uuid = this.resolveCallKitUUID(raw);

    if (this.endingCallUUID === uuid) {
      // eslint-disable-next-line no-console
      console.log('[XCALL][KIT] endCall — re-entry guard hit', { uuid });
      return; // already ending — break loop
    }

    // eslint-disable-next-line no-console
    console.log('[XCALL][KIT] endCall — calling RNCallKeep.endCall', {
      input: raw,
      resolved: uuid,
    });
    try {
      RNCallKeep.endCall(uuid);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[XCALL][KIT] endCall — RNCallKeep.endCall threw', {
        uuid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this._cleanupCall(uuid);
  }

  /**
   * Report to CallKit that a call ended for an EXTERNAL / remote reason.
   * (CALL_DISMISS push, remote hang-up, answered on another device, timeout.)
   *
   * Uses reportEndCallWithUUID instead of endCall so iOS removes the ringing
   * UI directly without creating a CXEndCallAction that would loop back as an
   * `endCall` event and trigger a spurious declineCall() API call.
   *
   * @param callUUID - CallKit UUID or backend callId.
   * @param reason   - Why the call ended remotely.
   */
  reportCallEnded(callUUID: string, reason: CallEndReason): void {
    const uuid = this.resolveCallKitUUID(callUUID);
    const reasonCode = END_CALL_REASON_CODES[reason];

    // eslint-disable-next-line no-console
    console.log('[XCALL][KIT] reportCallEnded — calling reportEndCallWithUUID', {
      input: callUUID,
      resolved: uuid,
      reason,
      reasonCode,
    });
    try {
      RNCallKeep.reportEndCallWithUUID(uuid, reasonCode);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[XCALL][KIT] reportCallEnded — reportEndCallWithUUID threw', {
        uuid,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this._cleanupCall(uuid);
  }

  /** The CallKit UUID of the currently answered/active call, or null. */
  getActiveCallUUID(): string | null {
    return this.activeCallUUID;
  }

  /** Rings CallKit displayed that have not been answered on this device. */
  getRingingCalls(): RingingCall[] {
    const ringing: RingingCall[] = [];
    for (const [callUUID, payload] of this.incomingCallPayloads) {
      if (this.activeCallUUID && isSameCallKitUUID(this.activeCallUUID, callUUID)) continue;
      ringing.push({
        callId: payload.callId,
        callUUID,
        displayedAt: this.displayedAt.get(callUUID) ?? 0,
      });
    }
    return ringing;
  }

  /**
   * Retire all JS/native payload state when the authenticated session ends.
   * CallKit owns the system UI, so tracked calls are explicitly reported as
   * ended before their payloads and callbacks are discarded.
   */
  clearSessionState(): void {
    this.lifecycleGeneration += 1;
    this.sessionActive = false;
    this.endingCallUUID = null;
    this.pendingColdStartAnswer = null;
    const uuidsToEnd = new Set(this.incomingCallPayloads.keys());
    if (this.activeCallUUID) uuidsToEnd.add(this.activeCallUUID);
    for (const uuid of uuidsToEnd) {
      try {
        RNCallKeep.reportEndCallWithUUID(uuid, END_CALL_REASON_CODES.REMOTE_ENDED);
      } catch {
        // Best effort; payload state is still retired below.
      }
    }
    this.incomingCallPayloads.clear();
    this.payloadByCallId.clear();
    for (const timer of this.ringTimeouts.values()) {
      clearTimeout(timer);
    }
    this.ringTimeouts.clear();
    this.activeCallUUID = null;
    this.handlers = {};
  }

  /** Awaitable native cleanup used by the bounded logout cleanup runner. */
  clearPendingNativeState(): Promise<void> {
    try {
      return Promise.resolve(PendingCallModule.clearPendingCall()).then(
        () => undefined,
        () => undefined,
      );
    } catch {
      // The optional native module may be absent or partially initialized.
      return Promise.resolve();
    }
  }

  // Unused stubs kept for interface compatibility -------------------------

  async displayIncomingCall(_payload: CallKitPayload): Promise<void> {}
  startOutgoingCall(_callUUID: string, _displayName: string, _callType: CallKitCallType): void {}

  /**
   * Tell CallKit the call is connected. For incoming calls answered through
   * CallKit UI this is mostly informational; we use activeCallUUID so the
   * correct UUID is always used regardless of what the caller passes.
   */
  reportCallConnected(_callUUID?: string): void {
    const uuid = this.activeCallUUID ?? (_callUUID ? this.resolveCallKitUUID(_callUUID) : null);
    if (!uuid) return;
    this.clearRingTimeout(uuid);
    try {
      RNCallKeep.reportConnectedOutgoingCallWithUUID(uuid);
    } catch {
      // safe to ignore — iOS may reject this for incoming calls
    }
  }

  /** Bring the app to the foreground when the user answers from CallKit. */
  bringToForeground(): void {
    try {
      RNCallKeep.backToForeground();
    } catch {
      // ignore
    }
  }

  /**
   * Cache a payload keyed by callId so it can be found by getCallPayload().
   * The stored callUUID is the *resolved* CallKit UUID, never a bare callId.
   * Called by the call push pipeline when a VoIP/FCM push arrives in JS.
   */
  cacheIncomingCallPayload(payload: CallKitPayload): void {
    if (!this.sessionActive) return;
    const callUUID = this.resolveCallKitUUID(payload.callId);
    const resolved: CallKitPayload = { ...payload, callUUID };
    // eslint-disable-next-line no-console
    console.log('[XCALL][KIT] cacheIncomingCallPayload', {
      callId: payload.callId,
      callUUID,
      hasToken: !!payload.token,
      hasServerUrl: !!payload.serverUrl,
    });
    this.payloadByCallId.set(payload.callId, resolved);
    if (callUUID !== payload.callId) {
      this.payloadByCallId.set(callUUID, resolved);
    }
  }

  /**
   * Look up the CallKit UUID for a backend callId this service has seen.
   * Returns undefined when the call is unknown (use resolveCallKitUUID to
   * always get an identifier).
   */
  getCallUUIDByCallId(callId: string): string | undefined {
    for (const [uuid, payload] of this.incomingCallPayloads) {
      if (payload.callId === callId) {
        return uuid;
      }
    }
    return this.payloadByCallId.get(callId)?.callUUID;
  }

  /**
   * Return a cached payload for the given UUID or callId. Used as a fallback
   * when onAnswerCall fires without a payload.
   */
  getCallPayload(callUUID: string): CallKitPayload | undefined {
    return (
      this.incomingCallPayloads.get(callUUID) ??
      this.payloadByCallId.get(callUUID) ??
      // Linear search as last resort (callId stored as key may still match)
      [...this.incomingCallPayloads.values(), ...this.payloadByCallId.values()].find(
        p => p.callId === callUUID || isSameCallKitUUID(p.callUUID, callUUID),
      )
    );
  }

  /**
   * Drop bookkeeping for calls CallKit no longer knows about — ended natively
   * by a CALL_DISMISS or the native ring timeout while JS was asleep.
   */
  async reconcileWithSystemCalls(): Promise<void> {
    const generation = this.lifecycleGeneration;
    let calls: SystemCall[];
    try {
      calls = (await RNCallKeep.getCalls()) as SystemCall[];
    } catch {
      return;
    }
    if (!this.sessionActive || generation !== this.lifecycleGeneration || !Array.isArray(calls)) {
      return;
    }

    const live = new Set(
      calls
        .filter(call => !call.hasEnded && typeof call.callUUID === 'string')
        .map(call => call.callUUID.toLowerCase()),
    );

    for (const uuid of [...this.incomingCallPayloads.keys()]) {
      if (!live.has(uuid.toLowerCase())) {
        // eslint-disable-next-line no-console
        console.log('[XCALL][KIT] reconcile — dropping call CallKit no longer has', { uuid });
        this._cleanupCall(uuid);
      }
    }
    if (this.activeCallUUID && !live.has(this.activeCallUUID.toLowerCase())) {
      this.activeCallUUID = null;
    }
  }

  /**
   * Index rings CallKit displayed while no JS listener was attached. Their
   * didDisplayIncomingCall events wait in CallKeep's queue until call setup
   * replays them, so a CALL_DISMISS handled before then — a push-launched cold
   * start — would find no payload for the ring. Read-only: the queue is left
   * for that replay.
   */
  async indexQueuedDisplayedCalls(): Promise<void> {
    let events: unknown;
    try {
      events = await RNCallKeep.getInitialEvents();
    } catch {
      return;
    }
    if (!Array.isArray(events)) return;

    for (const event of events as QueuedCallKeepEvent[]) {
      if (event?.name !== 'RNCallKeepDidDisplayIncomingCall') continue;
      const { callUUID, payload, errorCode } = event.data ?? {};
      if (errorCode || typeof callUUID !== 'string' || !payload) continue;
      if (this.incomingCallPayloads.has(callUUID)) continue;
      const parsed = parsePendingPayload(payload);
      if (parsed) {
        this.rememberDisplayedCall(callUUID, parsed);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private setupEventListeners(): void {
    // ------------------------------------------------------------------
    // answerCall — user tapped Accept in CallKit (warm-start or foreground)
    // ------------------------------------------------------------------
    RNCallKeep.addEventListener('answerCall', async (data: { callUUID: string }) => {
      if (!this.sessionActive) return;
      const generation = this.lifecycleGeneration;
      const { callUUID } = data;
      // eslint-disable-next-line no-console
      console.log('[XCALL][KIT] answerCall event (warm/foreground)', { callUUID });
      this.clearRingTimeout(callUUID);
      if (this.activeCallUUID === callUUID) {
        // eslint-disable-next-line no-console
        console.log('[XCALL][KIT] answerCall — already processing, skipped', { callUUID });
        return;
      }
      this.activeCallUUID = callUUID;

      const payload = await this.lookupPayload(callUUID, generation);
      if (!this.sessionActive || generation !== this.lifecycleGeneration) return;
      // eslint-disable-next-line no-console
      console.log('[XCALL][KIT] answerCall — dispatching onAnswerCall', {
        callUUID,
        payloadFound: !!payload,
        callId: payload?.callId,
      });
      this.handlers.onAnswerCall?.(callUUID, payload);
    });

    // ------------------------------------------------------------------
    // endCall — user tapped End/Decline in CallKit UI
    // ------------------------------------------------------------------
    RNCallKeep.addEventListener('endCall', (data: { callUUID: string }) => {
      if (!this.sessionActive) return;
      const { callUUID } = data;
      // eslint-disable-next-line no-console
      console.log('[XCALL][KIT] endCall event from CallKit UI (local user action)', { callUUID });

      this.endingCallUUID = callUUID; // guard against re-entry
      // Any index will do: without a payload there is no callId, and the decline is never sent.
      const payload = this.getCallPayload(callUUID);
      this._cleanupCall(callUUID);

      this.handlers.onEndCall?.(callUUID, payload);
      this.endingCallUUID = null;
    });

    // ------------------------------------------------------------------
    // didDisplayIncomingCall — CallKit UI is shown; cache the payload
    // ------------------------------------------------------------------
    RNCallKeep.addEventListener('didDisplayIncomingCall', (data: DidDisplayIncomingCallEvent) => {
      if (!this.sessionActive) return;
      const { callUUID, payload, error, errorCode } = data;
      if (errorCode) {
        // CallUUIDAlreadyExists is expected when native re-reports a ringing
        // UUID to satisfy PushKit for a dismiss push; nothing new is ringing.
        // eslint-disable-next-line no-console
        console.warn('[XCALL][KIT] didDisplayIncomingCall — CallKit rejected report', {
          callUUID,
          errorCode,
          error,
        });
        return;
      }
      if (!payload) {
        // eslint-disable-next-line no-console
        console.warn('[XCALL][KIT] didDisplayIncomingCall — NO payload in event', { callUUID });
        this.startRingTimeout(callUUID);
        return;
      }
      const parsed = parsePendingPayload(payload as Record<string, unknown>);
      if (!parsed) {
        // eslint-disable-next-line no-console
        console.warn('[XCALL][KIT] didDisplayIncomingCall — payload parse FAILED', { callUUID });
        this.startRingTimeout(callUUID);
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[XCALL][KIT] didDisplayIncomingCall — payload cached', {
        callUUID,
        callId: parsed.callId,
        hasToken: !!parsed.token,
      });
      this.rememberDisplayedCall(callUUID, parsed);
      this.startRingTimeout(callUUID);
    });

    // ------------------------------------------------------------------
    // didLoadWithEvents — cold-start: process events queued before JS loaded
    // ------------------------------------------------------------------
    RNCallKeep.addEventListener(
      'didLoadWithEvents',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (events: any[]) => {
        if (!this.sessionActive) return;
        const generation = this.lifecycleGeneration;
        const eventNames = events.map((e: { name: string }) => e.name);
        // eslint-disable-next-line no-console
        console.log('[XCALL][KIT] didLoadWithEvents (cold-start)', {
          count: events.length,
          events: eventNames,
        });

        // ── Pass 1: populate payload cache from buffered display events ──
        for (const event of events) {
          if (event.name === 'RNCallKeepDidDisplayIncomingCall') {
            const uuid = event.data?.callUUID as string | undefined;
            const errorCode = event.data?.errorCode as string | undefined;
            const rawPayload = event.data?.payload as Record<string, unknown> | undefined;
            if (errorCode) {
              // eslint-disable-next-line no-console
              console.warn('[XCALL][KIT] cold-start pass1 — display event carried error', {
                uuid,
                errorCode,
              });
              continue;
            }
            if (uuid && rawPayload) {
              const parsed = parsePendingPayload(rawPayload);
              if (parsed) {
                // eslint-disable-next-line no-console
                console.log('[XCALL][KIT] cold-start pass1 — payload cached', {
                  uuid,
                  callId: parsed.callId,
                  hasToken: !!parsed.token,
                });
                this.rememberDisplayedCall(uuid, parsed);
              } else {
                // eslint-disable-next-line no-console
                console.warn('[XCALL][KIT] cold-start pass1 — payload parse FAILED', { uuid });
              }
            } else {
              // eslint-disable-next-line no-console
              console.warn(
                '[XCALL][KIT] cold-start pass1 — display event missing uuid or payload',
                { uuid, hasRawPayload: !!rawPayload },
              );
            }
          }
        }

        // ── Pass 2: process answer / end actions ──
        for (const event of events) {
          if (event.name === 'RNCallKeepPerformAnswerCallAction') {
            if (!this.sessionActive || generation !== this.lifecycleGeneration) return;
            const uuid = event.data?.callUUID;
            if (!uuid || this.activeCallUUID === uuid) continue;
            this.activeCallUUID = uuid;

            const payload = await this.lookupPayload(uuid, generation);
            if (!this.sessionActive || generation !== this.lifecycleGeneration) return;
            // eslint-disable-next-line no-console
            console.log('[XCALL][KIT] cold-start pass2 — answerCall', {
              uuid,
              payloadFound: !!payload,
              callId: payload?.callId,
              hasHandlers: !!this.handlers.onAnswerCall,
            });

            if (this.handlers.onAnswerCall) {
              this.handlers.onAnswerCall(uuid, payload);
            } else {
              // Handlers not set yet — queue for when setEventHandlers() is called
              this.pendingColdStartAnswer = payload
                ? { uuid, payload, generation }
                : { uuid, generation };
              // eslint-disable-next-line no-console
              console.log('[XCALL][KIT] cold-start — queued pendingColdStartAnswer', {
                uuid,
                hasPayload: !!payload,
              });
            }
            break;
          }

          if (event.name === 'RNCallKeepPerformEndCallAction') {
            if (!this.sessionActive || generation !== this.lifecycleGeneration) return;
            const endUUID = (event.data as { callUUID?: string } | undefined)?.callUUID;
            if (!endUUID) continue;
            // eslint-disable-next-line no-console
            console.log('[XCALL][KIT] cold-start pass2 — endCall action', { endUUID });
            const endPayload = this.getCallPayload(endUUID);
            this._cleanupCall(endUUID);
            this.handlers.onEndCall?.(endUUID, endPayload);
          }
        }

        // Anything displayed but neither answered nor ended is still ringing:
        // arm the JS mirror of the native ring timeout for it.
        for (const uuid of this.incomingCallPayloads.keys()) {
          if (this.activeCallUUID !== uuid) {
            this.startRingTimeout(uuid);
          }
        }

        try {
          if (!this.sessionActive || generation !== this.lifecycleGeneration) return;
          RNCallKeep.clearInitialEvents();
        } catch {
          /* ignore */
        }
      },
    );

    // ------------------------------------------------------------------
    // didPerformSetMutedCallAction — mute tapped on the CallKit / lock-screen
    // UI. Without this the system shows "muted" while the mic stays live.
    // ------------------------------------------------------------------
    RNCallKeep.addEventListener(
      'didPerformSetMutedCallAction',
      (data: { muted: boolean; callUUID: string }) => {
        const { muted, callUUID } = data;
        if (this.activeCallUUID && !isSameCallKitUUID(this.activeCallUUID, callUUID)) {
          return;
        }
        // eslint-disable-next-line no-console
        console.log('[XCALL][KIT] didPerformSetMutedCallAction', { callUUID, muted });
        this.handlers.onSetMuted?.(callUUID, muted);
      },
    );

    // ------------------------------------------------------------------
    // Audio session — CallKit notifies us when it activates/deactivates
    // the audio session so LiveKit can safely start audio.
    // ------------------------------------------------------------------
    RNCallKeep.addEventListener('didActivateAudioSession', () => {
      // setReachable() is Android-only; calling it on iOS is a no-op.
      // Keep this listener so the native event is consumed and not queued.
    });

    RNCallKeep.addEventListener('didDeactivateAudioSession', () => {
      // No-op: AudioSession cleanup is handled by CallRuntimeNativeService.disconnect()
      // This listener exists to prevent unhandled native events from being queued.
    });
  }

  /** Index a call CallKit reported under the UUID it actually used. */
  private rememberDisplayedCall(callUUID: string, payload: CallKitPayload): void {
    const resolved: CallKitPayload = { ...payload, callUUID };
    this.incomingCallPayloads.set(callUUID, resolved);
    if (!this.displayedAt.has(callUUID)) {
      this.displayedAt.set(callUUID, Date.now());
      this.handlers.onIncomingCallDisplayed?.(resolved);
    }
    this.payloadByCallId.set(payload.callId, resolved);
    if (callUUID !== payload.callId) {
      this.payloadByCallId.set(callUUID, resolved);
    }
  }

  /**
   * JS mirror of the native ring timeout. Native ends the ring first; this
   * only guarantees our maps and the in-app state agree with CallKit.
   */
  private startRingTimeout(uuid: string): void {
    this.clearRingTimeout(uuid);
    const timer = setTimeout(() => {
      this.ringTimeouts.delete(uuid);
      if (this.activeCallUUID === uuid) return; // answered
      if (!this.incomingCallPayloads.has(uuid)) return; // already ended
      // eslint-disable-next-line no-console
      console.log('[XCALL][KIT] ring timeout — reporting UNANSWERED', { uuid });
      this.reportCallEnded(uuid, 'UNANSWERED');
    }, CALL_RING_TIMEOUT_MS + RING_TIMEOUT_GRACE_MS);
    this.ringTimeouts.set(uuid, timer);
  }

  private clearRingTimeout(uuid: string): void {
    const timer = this.ringTimeouts.get(uuid);
    if (timer) {
      clearTimeout(timer);
      this.ringTimeouts.delete(uuid);
    }
  }

  /** Look up a CallKitPayload for a given UUID from memory, then from native storage. */
  private async lookupPayload(
    callUUID: string,
    generation = this.lifecycleGeneration,
  ): Promise<CallKitPayload | undefined> {
    const cached = this.incomingCallPayloads.get(callUUID) ?? this.getCallPayload(callUUID);
    if (cached) {
      // eslint-disable-next-line no-console
      console.log('[XCALL][KIT] lookupPayload — found in memory', {
        callUUID,
        callId: cached.callId,
      });
      return cached;
    }

    try {
      const stored = await PendingCallModule.getStoredPayload(callUUID);
      if (!this.sessionActive || generation !== this.lifecycleGeneration) return undefined;
      if (stored) {
        const parsed = parsePendingPayload(stored);
        if (parsed) {
          // eslint-disable-next-line no-console
          console.log('[XCALL][KIT] lookupPayload — found in PendingCallModule', {
            callUUID,
            callId: parsed.callId,
          });
          this.rememberDisplayedCall(callUUID, parsed);
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }

    // eslint-disable-next-line no-console
    console.warn('[XCALL][KIT] lookupPayload — NOT FOUND (payload will be missing)', { callUUID });
    return undefined;
  }

  /** Remove all state for a given CallKit UUID. */
  private _cleanupCall(uuid: string): void {
    this.clearRingTimeout(uuid);
    const payload = this.incomingCallPayloads.get(uuid);
    this.incomingCallPayloads.delete(uuid);
    this.displayedAt.delete(uuid);
    if (payload) {
      this.payloadByCallId.delete(payload.callId);
    }
    this.payloadByCallId.delete(uuid);
    for (const [key, cached] of [...this.payloadByCallId.entries()]) {
      if (isSameCallKitUUID(cached.callUUID, uuid)) {
        this.payloadByCallId.delete(key);
      }
    }
    if (this.activeCallUUID === uuid) this.activeCallUUID = null;
  }
}

export const callKitService = new CallKitService();
