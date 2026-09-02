import {
  RoomServiceClient,
  AccessToken,
  AgentDispatchClient,
  TrackSource,
  TwirpError,
  type ParticipantInfo,
} from 'livekit-server-sdk';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { repositories } from '@/database/repositories';
import {
  DEFAULT_TRANSCRIPTION_AGENT_ROLE,
  type TranscriptionAgentRole,
} from '@/database/repositories/transcriptionAgent';
import { superpositionClient } from '@/services/superpositionClient';
import { DEFAULT_HOST_CONTROLS, normalizeHostControls, type HostControls } from '@xyne/shared';

/**
 * Superposition/CAC flag naming which agent role/slot a call creator routes to (e.g.
 * 'default', 'test', or any future slot — open-ended, not a fixed set). Placeholder key
 * — needs an actual flag created in Superposition's dashboard (outside this repo) before
 * this does anything but fall through to NO_EXPLICIT_DISPATCH.
 */
const TRANSCRIPTION_AGENT_ROLE_FLAG = 'transcription_agent_role';

/**
 * Superposition's own stored default-config value for TRANSCRIPTION_AGENT_ROLE_FLAG —
 * NOT a DB role name, and deliberately distinct from DEFAULT_TRANSCRIPTION_AGENT_ROLE.
 * Every user without an explicit per-user CAC context override resolves to this value,
 * which means it must mean "skip explicit dispatch, automatic dispatch is this user's
 * only agent" — never "look up the DB's 'default' slot." That DB slot is reserved for
 * CAC-listed users' own fallback (see resolveAgentName) — it must never be reachable by
 * a user who was never explicitly routed anywhere, or every unlisted user would start
 * getting a duplicate explicit dispatch the moment 'default' gets an active row.
 */
const NO_EXPLICIT_DISPATCH = 'none';

/**
 * Retry pacing for the agent-missing watch loop: 30s, 1m, 2m, 4m, 8m, then every 10m, each
 * plus 1-10s of jitter. Unbounded on purpose — under explicit dispatch there is no ambient
 * worker pool to fall back on, so a call that loses its agent must keep retrying for as long
 * as the call itself runs. This same loop handles both "agent crashed mid-call" and "agent
 * pod is temporarily at capacity" — LiveKit gives no way to tell those apart (see
 * `checkDispatchClaimed` below), so both are just retried rather than distinguished.
 */
const REDISPATCH_RETRY_INITIAL_MS = 30 * 1000;
const REDISPATCH_RETRY_MAX_MS = 10 * 60 * 1000;
const REDISPATCH_JITTER_MIN_MS = 1000;
const REDISPATCH_JITTER_MAX_MS = 10 * 1000;

/** Serializes re-dispatches for one room against duplicate webhook deliveries/replicas. */
const REDISPATCH_COOLDOWN_SECONDS = 15;
const redispatchCooldownKey = (roomName: string) => `livekit:agent-redispatch:cooldown:${roomName}`;

/** How long after createDispatch we check whether any worker actually claimed the job. */
const DISPATCH_CLAIM_CHECK_DELAY_MS = 9 * 1000;

function nextRedispatchDelayMs(retryIndex: number): number {
  const backoffMs = Math.min(REDISPATCH_RETRY_INITIAL_MS * 2 ** retryIndex, REDISPATCH_RETRY_MAX_MS);
  const jitterMs = REDISPATCH_JITTER_MIN_MS + Math.random() * (REDISPATCH_JITTER_MAX_MS - REDISPATCH_JITTER_MIN_MS);
  return Math.round(backoffMs + jitterMs);
}

type RedispatchOutcome = 'dispatched' | 'dispatch_failed' | 'cooldown_active' | 'agent_present' | 'room_inactive' | 'no_humans' | 'error';
const TERMINAL_REDISPATCH_OUTCOMES = new Set<RedispatchOutcome>(['agent_present', 'room_inactive', 'no_humans']);

export function isAgentParticipant(participant: ParticipantInfo): boolean {
  return participant.kind === ParticipantInfo_Kind.AGENT || participant.identity.startsWith('agent-');
}

export function isHumanParticipant(participant: ParticipantInfo): boolean {
  return !isAgentParticipant(participant) && participant.kind !== ParticipantInfo_Kind.EGRESS;
}

export interface LiveKitRoomOptions {
  name: string;
  maxParticipants?: number;
  emptyTimeout?: number;
  metadata?: string;
}

export interface LiveKitTokenOptions {
  userIdentity: string;
  roomName: string;
  userName?: string;
  ttl?: string;
  metadata?: string;
  /** Restricts publishable track sources. */
  canPublishSources?: TrackSource[];
}

export function allowedSourcesForHostControls(hostControls: HostControls): TrackSource[] {
  const allowed: TrackSource[] = [];
  if (!hostControls.turnOffAudio) allowed.push(TrackSource.MICROPHONE);
  if (!hostControls.turnOffCamera) allowed.push(TrackSource.CAMERA);
  if (!hostControls.turnOffScreenShare) {
    allowed.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }
  return allowed;
}

export function hasTurnedOffHostControl(hostControls: HostControls): boolean {
  return hostControls.turnOffAudio || hostControls.turnOffCamera || hostControls.turnOffScreenShare;
}

export function isLiveKitNotFoundError(error: unknown): boolean {
  if (error instanceof TwirpError) {
    return error.status === 404 || error.code === 'not_found';
  }

  if (!error || typeof error !== 'object') return false;

  const maybeError = error as { status?: unknown; code?: unknown };
  return maybeError.status === 404 || maybeError.code === 'not_found';
}

export function getHostControls(call: { metadata: unknown } | null): HostControls {
  const metadata = call?.metadata;
  const stored =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as { hostControls?: unknown }).hostControls
      : undefined;

  return normalizeHostControls(stored) ?? DEFAULT_HOST_CONTROLS;
}

function parseRoomMetadata(
  roomName: string,
  rawMetadata: string | undefined,
  operation: string,
): Record<string, unknown> {
  if (!rawMetadata) return {};

  try {
    const parsed = JSON.parse(rawMetadata) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    logger.warn(
      `[LiveKit] Ignoring non-object room metadata | room=${roomName}, operation=${operation}`,
    );
  } catch (error) {
    logger.warn(
      `[LiveKit] Failed to parse room metadata | room=${roomName}, operation=${operation}, error=${error}`,
    );
  }

  return {};
}

export class LiveKitService {
  private static instance: LiveKitService;
  private roomService: RoomServiceClient;
  private agentDispatch: AgentDispatchClient;
  /** Rooms being watched for a missing transcription agent — one retry chain per room. */
  private redispatchWatchers = new Map<string, NodeJS.Timeout>();
  private apiKey: string;
  private apiSecret: string;
  private serverUrl: string;
  private clientUrl: string;
  private livekitUrl: string;

  private constructor() {
    this.apiKey = config.livekit.apiKey;
    this.apiSecret = config.livekit.apiSecret;
    this.livekitUrl = config.livekit.url;
    this.serverUrl = config.livekit.serverUrl;
    this.clientUrl = config.livekit.clientUrl;

    // Initialize room service client
    this.roomService = new RoomServiceClient(
      this.livekitUrl,
      this.apiKey,
      this.apiSecret,
    );

    // Explicit agent dispatch client (routes the transcription agent into rooms)
    this.agentDispatch = new AgentDispatchClient(
      this.livekitUrl,
      this.apiKey,
      this.apiSecret,
    );

    logger.info('LiveKit Service initialized', {
      serverUrl: this.serverUrl,
      clientUrl: this.clientUrl,
      livekitUrl: this.livekitUrl,
    });
  }

  public static getInstance(): LiveKitService {
    if (!LiveKitService.instance) {
      LiveKitService.instance = new LiveKitService();
    }
    return LiveKitService.instance;
  }

  async createRoom(options: LiveKitRoomOptions): Promise<void> {
    try {
      await this.roomService.createRoom({
        name: options.name,
        maxParticipants: options.maxParticipants || 100,
        emptyTimeout: options.emptyTimeout || 120,
        metadata: options.metadata,
      });

      logger.info(`[${options.name}] livekit_room_created | max_participants=${options.maxParticipants || 100}, empty_timeout=${options.emptyTimeout || 120}`);
    } catch (error) {
      logger.error(`[${options.name}] livekit_room_creation_failed | error=${error}`);
      throw error;
    }
  }

  /**
   * Resolves both the role (via the Superposition/CAC role flag, evaluated for the call
   * creator) and the agent_name to dispatch, in one call — this is what a call creation
   * site actually wants. The flag returns an open-ended role string (any value the DB
   * currently has an active row for), not a fixed set — adding a new slot (a 3rd, 4th
   * canary arm, etc.) needs zero code changes here, only a rollout call naming it and a
   * CAC change routing some users to it. The flag key below is a placeholder pending an
   * actual flag being created in Superposition's dashboard (outside this repo) — confirm
   * the real key name before relying on this in anything but a test environment.
   */
  async resolveAgentNameForUser(userId: string): Promise<string | null> {
    let role: string;
    try {
      role = await superpositionClient.getStringValue(
        TRANSCRIPTION_AGENT_ROLE_FLAG,
        NO_EXPLICIT_DISPATCH,
        { userId },
      );
    } catch (error) {
      // CAC/user-matching failure: treat exactly like an unlisted user rather than
      // falling back to DEFAULT_TRANSCRIPTION_AGENT_ROLE — a Superposition outage must
      // not suddenly hand every production user a second explicit-dispatch agent.
      // Automatic dispatch is still there regardless, so this fails safe either way.
      logger.error(`transcription_agent_role_resolution_failed | userId=${userId}, error=${error}, falling_back_to=no_explicit_dispatch`);
      return null;
    }

    if (role === NO_EXPLICIT_DISPATCH) return null;
    return this.resolveAgentName(role);
  }

  /**
   * Resolves which agent_name should be dispatched for a NEW call in `role`. Any
   * non-default role falls back to `DEFAULT_TRANSCRIPTION_AGENT_ROLE` when nothing
   * currently holds that slot — this is the only fallback rule for initial resolution; a
   * role that IS assigned but not currently claimable is a different situation, handled
   * by the retry loop below, not by silently jumping to another role mid-attempt.
   */
  async resolveAgentName(role: TranscriptionAgentRole): Promise<string | null> {
    try {
      const row = await repositories.transcriptionAgents.getActive(role);
      if (row) return row.agentName;
      if (role !== DEFAULT_TRANSCRIPTION_AGENT_ROLE) {
        const defaultRow = await repositories.transcriptionAgents.getActive(DEFAULT_TRANSCRIPTION_AGENT_ROLE);
        return defaultRow?.agentName ?? null;
      }
      return null;
    } catch (error) {
      // A DB error here (not "no row" — an actual query failure) must not cascade into
      // failing the whole call join/creation. "No agent dispatched" is an accepted
      // outcome; "user can't join their call" is not — same fail-safe contract as the
      // CAC lookup in resolveAgentNameForUser.
      logger.error(`transcription_agent_role_lookup_failed | role=${role}, error=${error}, falling_back_to=no_explicit_dispatch`);
      return null;
    }
  }

  /** Bare explicit-dispatch call — best-effort, never throws. Returns null on failure. */
  private async dispatchTranscriptionAgent(roomName: string, agentName: string) {
    try {
      const dispatch = await this.agentDispatch.createDispatch(roomName, agentName);
      logger.info(`[${roomName}] transcription_agent_dispatched | dispatch_id=${dispatch.id}, agent=${agentName}`);
      return dispatch;
    } catch (error) {
      logger.error(`[${roomName}] transcription_agent_dispatch_failed | agent=${agentName}, error=${error}`);
      return null;
    }
  }

  /**
   * Explicitly dispatches `agentName` into `roomName` for a real call. Fire-and-forget
   * from the caller's perspective: on success, schedules a one-shot check ~9s later
   * (`checkDispatchClaimed`) that arms the crash-redispatch loop if nothing claimed it.
   * On the `createDispatch` call itself throwing, arms the same loop immediately.
   */
  async dispatchTranscriptionAgentForCall(roomName: string, agentName: string): Promise<{ dispatchId: string } | null> {
    const dispatch = await this.dispatchTranscriptionAgent(roomName, agentName);
    if (!dispatch) {
      void this.ensureTranscriptionAgent(roomName, agentName, { reason: 'initial_dispatch_call_failed' });
      return null;
    }

    this.scheduleClaimCheck(roomName, dispatch.id, agentName, { allowFallback: true });
    return { dispatchId: dispatch.id };
  }

  private scheduleClaimCheck(roomName: string, dispatchId: string, agentName: string, options: { allowFallback: boolean }): void {
    const timer = setTimeout(() => {
      this.checkDispatchClaimed(roomName, dispatchId, agentName, options.allowFallback).catch((error) => {
        logger.warn(`[${roomName}] dispatch_claim_check_failed | dispatch_id=${dispatchId}, error=${error}`);
      });
    }, DISPATCH_CLAIM_CHECK_DELAY_MS);
    timer.unref?.();
  }

  /**
   * Fires ~9s after a per-call dispatch. LiveKit's `createDispatch` never validates
   * `agentName` and never errors — a typo'd name and a pod at capacity both look
   * identical (`JS_PENDING`, empty `workerId`) forever. We deliberately don't try to
   * tell them apart: bad name, dead pod, timeout — anything unclaimed gets the same
   * treatment.
   *
   * `allowFallback` is what keeps this fail-fast substitution scoped to the INITIAL
   * dispatch only: nobody has joined expecting continuity from a specific agent build
   * yet at this point, so swapping straight to the default agent (one substitution,
   * never chained further) is safe and fast — no 30s-plus wait through the unbounded
   * crash-redispatch backoff before the call gets *any* working agent. A mid-call crash
   * (`redispatchTranscriptionAgentIfMissing`) intentionally does NOT go through this path
   * — it keeps retrying the SAME pinned agent, since silently swapping an agent out from
   * under an in-progress call is a bigger, more disruptive change (would need a
   * user-visible signal / manual control, not an automatic silent swap).
   */
  private async checkDispatchClaimed(roomName: string, dispatchId: string, agentName: string, allowFallback: boolean): Promise<void> {
    const claimed = await this.isDispatchClaimed(roomName, dispatchId);
    if (claimed) return;

    logger.error(`[${roomName}] transcription_agent_dispatch_unclaimed | dispatch_id=${dispatchId}, agent=${agentName}, allow_fallback=${allowFallback}`);

    const fallbackAgentName = allowFallback ? await this.resolveFallbackAgentName(agentName) : null;
    if (fallbackAgentName) {
      logger.error(`[${roomName}] transcription_agent_fallback_to_default | from=${agentName}, to=${fallbackAgentName}, reason=dispatch_unclaimed`);
      await this.dispatchFallbackAgent(roomName, fallbackAgentName);
      return;
    }

    await this.ensureTranscriptionAgent(roomName, agentName, { reason: 'dispatch_unclaimed' });
  }

  /** Null when there's nothing to fall back to (default IS the agent that just failed, or has no active row). */
  private async resolveFallbackAgentName(failedAgentName: string): Promise<string | null> {
    const defaultRow = await repositories.transcriptionAgents.getActive(DEFAULT_TRANSCRIPTION_AGENT_ROLE);
    if (!defaultRow || defaultRow.agentName === failedAgentName) return null;
    return defaultRow.agentName;
  }

  /**
   * One-shot substitution dispatch, plus a claim-check on the fallback itself
   * (`allowFallback: false` — if even the default agent doesn't get claimed, there's
   * nothing left to substitute, so that path drops into the ordinary unbounded
   * crash-redispatch loop like any other "agent missing" case).
   */
  private async dispatchFallbackAgent(roomName: string, fallbackAgentName: string): Promise<void> {
    const dispatch = await this.dispatchTranscriptionAgent(roomName, fallbackAgentName);

    const call = await repositories.calls.findByExternalId(roomName);
    if (call) {
      await repositories.calls.update(call.id, {
        metadata: {
          ...(call.metadata as Record<string, unknown> ?? {}),
          agentName: fallbackAgentName,
          ...(dispatch?.id && { dispatchId: dispatch.id }),
          dispatchStatus: dispatch ? 'fallback_dispatched' : 'failed',
        },
      });
    }

    if (!dispatch) {
      void this.ensureTranscriptionAgent(roomName, fallbackAgentName, { reason: 'fallback_dispatch_call_failed' });
      return;
    }

    this.scheduleClaimCheck(roomName, dispatch.id, fallbackAgentName, { allowFallback: false });
  }

  private async isDispatchClaimed(roomName: string, dispatchId: string): Promise<boolean> {
    try {
      const dispatch = await this.agentDispatch.getDispatch(dispatchId, roomName);
      const job = dispatch?.state?.jobs?.[0];
      return Boolean(job?.state?.workerId);
    } catch (error) {
      logger.warn(`[${roomName}] dispatch_claim_check_call_failed | dispatch_id=${dispatchId}, error=${error}`);
      return false;
    }
  }

  /**
   * Live verification for a rollout: dispatches `agentName` into a disposable,
   * uniquely-named room and checks whether a worker claims it within ~9s. This is what
   * lets the rollout path reject a typo'd/undeployed name outright, and it's also the
   * on-startup self-check a pod's own rollout call effectively performs — same
   * mechanism, same room-scoped dispatch, just a throwaway room instead of a real call.
   */
  async verifyAgentLive(agentName: string): Promise<boolean> {
    const verifyRoomName = `agent-verify-${agentName}-${Date.now()}`;
    const dispatch = await this.dispatchTranscriptionAgent(verifyRoomName, agentName);
    if (!dispatch) return false;

    await new Promise((resolve) => setTimeout(resolve, DISPATCH_CLAIM_CHECK_DELAY_MS));
    const claimed = await this.isDispatchClaimed(verifyRoomName, dispatch.id);

    await this.roomService.deleteRoom(verifyRoomName).catch(() => {
      // Best-effort cleanup — an unclaimed verification room just expires on its own.
    });

    return claimed;
  }

  /**
   * Verify-then-commit, shared by both trigger paths: the human-facing rollout endpoint
   * and a pod's own on-startup self-report call. Neither writes to the DB directly —
   * both go through this, so a bad/unclaimed name can never reach the table regardless
   * of who's asking. No cross-role logic here on purpose — this only ever touches the
   * one role it was called with; a build holding both `test` and `default` as two
   * separate rows is expected, not something this reconciles.
   */
  async attemptTranscriptionAgentRollout(
    agentName: string,
    role: TranscriptionAgentRole,
  ): Promise<{ success: true } | { success: false; reason: string }> {
    // Idempotent no-op: `role`'s active holder is already this exact agentName. This is
    // the common case when N replicas of the same build each self-report independently
    // on startup — skip before doing anything, so replicas 2..N don't each fire a real
    // verification dispatch (a throwaway-room createDispatch + ~9s wait) and don't each
    // demote+re-insert a row that's already correct. Keeps the table from accumulating a
    // fresh row per replica for what is, functionally, the same rollout.
    const current = await repositories.transcriptionAgents.getActive(role);
    if (current?.agentName === agentName) {
      logger.info(`transcription_agent_rollout_noop | agentName=${agentName}, role=${role}, reason=already_active`);
      return { success: true };
    }

    const claimed = await this.verifyAgentLive(agentName);
    if (!claimed) {
      logger.error(`transcription_agent_rollout_rejected | agentName=${agentName}, role=${role}, reason=not_claimed`);
      return { success: false, reason: 'agent_not_claimed' };
    }

    await repositories.transcriptionAgents.rollout(agentName, role);
    logger.warn(`transcription_agent_rolled_out | agentName=${agentName}, role=${role}`);
    return { success: true };
  }

  /**
   * Identities in `roomName` running under `agentName`. Goes through the dispatch API
   * because `listParticipants` has no agent_name field.
   */
  private async liveAgentIdentitiesForName(roomName: string, agentName: string): Promise<Set<string> | null> {
    try {
      const dispatches = await this.agentDispatch.listDispatch(roomName);
      const identities = new Set<string>();
      for (const dispatch of dispatches) {
        if (dispatch.agentName !== agentName) continue;
        for (const job of dispatch.state?.jobs ?? []) {
          const identity = job.state?.participantIdentity;
          if (identity) identities.add(identity);
        }
      }
      return identities;
    } catch (error) {
      logger.warn(`[${roomName}] agent_dispatch_list_failed | agent=${agentName}, error=${error}`);
      return null;
    }
  }

  /** One re-dispatch attempt into a room that is still live but has lost its agent. Never throws. */
  async redispatchTranscriptionAgentIfMissing(
    roomName: string,
    agentName: string,
    options: { excludeIdentity?: string; reason: string; attempt?: number },
  ): Promise<RedispatchOutcome> {
    const { excludeIdentity, reason, attempt = 0 } = options;

    try {
      if (!(await this.acquireRedispatchCooldown(roomName))) {
        logger.info(`[${roomName}] agent_redispatch_skipped | reason=cooldown_active, trigger=${reason}`);
        return 'cooldown_active';
      }

      const room = await this.getRoomInfo(roomName);
      if (!room) {
        logger.info(`[${roomName}] agent_redispatch_stopped | reason=room_not_active, trigger=${reason}`);
        return 'room_inactive';
      }

      const participants = await this.listParticipants(roomName);
      const remaining = participants.filter((p) => p.identity !== excludeIdentity);

      if (!remaining.some(isHumanParticipant)) {
        logger.info(`[${roomName}] agent_redispatch_stopped | reason=no_human_participants, trigger=${reason}`);
        return 'no_humans';
      }

      const liveAgentIdentities = await this.liveAgentIdentitiesForName(roomName, agentName);
      const agentStillPresent = liveAgentIdentities
        ? remaining.some((p) => liveAgentIdentities.has(p.identity))
        : remaining.some(isAgentParticipant);

      if (agentStillPresent) {
        logger.info(`[${roomName}] agent_redispatch_stopped | reason=agent_already_present, trigger=${reason}`);
        return 'agent_present';
      }

      logger.info(`[${roomName}] agent_redispatch_attempt | attempt=${attempt}, trigger=${reason}, agent=${agentName}, humans=${remaining.filter(isHumanParticipant).length}`);

      const dispatch = await this.dispatchTranscriptionAgent(roomName, agentName);
      return dispatch ? 'dispatched' : 'dispatch_failed';
    } catch (error) {
      logger.error(`[${roomName}] agent_redispatch_failed | trigger=${reason}, error=${error}`);
      return 'error';
    }
  }

  /** Unbounded backoff loop — keeps retrying until the agent rejoins, the call ends, or everyone leaves. */
  private scheduleRedispatchWatch(roomName: string, agentName: string, excludeIdentity?: string, retryIndex = 0): void {
    if (this.redispatchWatchers.has(roomName)) return;

    const delayMs = nextRedispatchDelayMs(retryIndex);
    logger.info(`[${roomName}] agent_redispatch_watch_scheduled | retry_index=${retryIndex}, next_check_in_ms=${delayMs}`);

    const timer = setTimeout(async () => {
      this.redispatchWatchers.delete(roomName);

      const outcome = await this.redispatchTranscriptionAgentIfMissing(roomName, agentName, {
        excludeIdentity,
        reason: 'redispatch_watch',
        attempt: retryIndex + 1,
      });

      if (!TERMINAL_REDISPATCH_OUTCOMES.has(outcome)) {
        this.scheduleRedispatchWatch(roomName, agentName, excludeIdentity, retryIndex + 1);
      }
    }, delayMs);

    timer.unref?.();
    this.redispatchWatchers.set(roomName, timer);
  }

  /** Entry point for "the transcription agent is missing" — one immediate attempt, then a backoff watch. */
  async ensureTranscriptionAgent(
    roomName: string,
    agentName: string,
    options: { excludeIdentity?: string; reason: string },
  ): Promise<void> {
    const outcome = await this.redispatchTranscriptionAgentIfMissing(roomName, agentName, options);
    if (!TERMINAL_REDISPATCH_OUTCOMES.has(outcome)) {
      this.scheduleRedispatchWatch(roomName, agentName, options.excludeIdentity);
    }
  }

  /** Tear down a room's retry chain because its call ended. */
  cancelRedispatchWatch(roomName: string): void {
    const timer = this.redispatchWatchers.get(roomName);
    if (!timer) return;
    clearTimeout(timer);
    this.redispatchWatchers.delete(roomName);
    logger.info(`[${roomName}] agent_redispatch_watch_cancelled | reason=call_ended`);
  }

  /** Fails OPEN: if Redis is down the feature must not silently switch off. */
  private async acquireRedispatchCooldown(roomName: string): Promise<boolean> {
    try {
      return await redisService.set(redispatchCooldownKey(roomName), String(Date.now()), REDISPATCH_COOLDOWN_SECONDS, true);
    } catch (error) {
      logger.warn(`[${roomName}] agent_redispatch_cooldown_unavailable | proceeding_without_guard, error=${error}`);
      return true;
    }
  }

  /**
   * Guards the room-create-or-recreate-then-dispatch sequence for one call against
   * concurrent joins racing each other (see `joinCall`'s delete-and-recreate branch for
   * SCHEDULED calls — two participants joining at once could each delete+recreate the
   * room and each request a dispatch). Fails OPEN if Redis is down. When the lock isn't
   * acquired, the caller is expected to skip its own create+dispatch entirely rather than
   * race the lock holder.
   */
  async withCallCreationLock<T>(callId: string, fn: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
    const lockKey = `livekit:call-creation:lock:${callId}`;
    let acquired: boolean;
    try {
      acquired = await redisService.set(lockKey, String(Date.now()), 10, true);
    } catch (error) {
      logger.warn(`[${callId}] call_creation_lock_unavailable | proceeding_without_guard, error=${error}`);
      acquired = true;
    }

    if (!acquired) return { acquired: false };

    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await redisService.del(lockKey).catch((error) => {
        logger.warn(`[${callId}] call_creation_lock_release_failed | error=${error}`);
      });
    }
  }

  /**
   * For the `withCallCreationLock` LOSER: a fixed sleep-then-proceed can't actually
   * guarantee the winner is done — `fn()` (CAC lookup + createRoom + dispatch) has no
   * fixed cost, so a blind timeout either wastes time when the winner finishes early or,
   * worse, lets the loser generate a join token and respond to the client BEFORE the room
   * (and its agentName metadata / dispatch) actually exist. Poll for the real completion
   * signal instead — the room existing — bounded so a stuck/crashed winner can't hang the
   * loser forever; the lock's own 10s TTL is the actual worst case, so this only needs to
   * cover slightly past that.
   */
  async waitForRoomReady(roomName: string, maxWaitMs = 11000, pollIntervalMs = 300): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const room = await this.getRoomInfo(roomName);
      if (room) return true;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    logger.warn(`[${roomName}] call_creation_lock_wait_timed_out | waited_ms=${maxWaitMs}, room_still_missing=true`);
    return false;
  }

  async muteTrack(roomName: string, identity: string, trackSid: string, muted: boolean): Promise<void> {
    try {
      await this.roomService.mutePublishedTrack(roomName, identity, trackSid, muted);
    } catch (error) {
      logger.error(`[${roomName}] mute_track_failed | identity=${identity}, track_sid=${trackSid}, error=${error}`);
      throw error;
    }
  }
  async generateAccessToken(options: LiveKitTokenOptions): Promise<string> {
    try {
      const at = new AccessToken(this.apiKey, this.apiSecret, {
        identity: options.userIdentity,
        name: options.userName,
        ttl: options.ttl || '10m',
        metadata: options.metadata,
      });

      at.addGrant({
        roomJoin: true,
        room: options.roomName,
        canPublish: options.canPublishSources === undefined || options.canPublishSources.length > 0,
        canSubscribe: true,
        canPublishData: true,
        ...(options.canPublishSources && { canPublishSources: options.canPublishSources }),
      });

      const token = await at.toJwt();
      logger.info(`[${options.roomName}] access_token_generated | user_id=${options.userIdentity}, ttl=${options.ttl || '10m'}`);
      return token;
    } catch (error) {
      logger.error(`[${options.roomName}] access_token_generation_failed | user_id=${options.userIdentity}, error=${error}`);
      throw error;
    }
  }

  async deleteRoom(roomName: string): Promise<void> {
    try {
      await this.roomService.deleteRoom(roomName);
      logger.info(`LiveKit room deleted: ${roomName}`);
    } catch (error) {
      logger.error('Failed to delete LiveKit room:', error);
      throw error;
    }
  }

  async listRooms(roomNames?: string[]): Promise<any[]> {
    try {
      const rooms = await this.roomService.listRooms(roomNames);
      return rooms;
    } catch (error) {
      logger.error('Failed to list LiveKit rooms:', error);
      throw error;
    }
  }

  async getRoomInfo(roomName: string): Promise<any> {
    try {
      const rooms = await this.roomService.listRooms([roomName]);
      if (rooms && rooms.length > 0) {
        return rooms[0];
      }
      return null;
    } catch (error) {
      logger.error(`Failed to get room info for ${roomName}:`, error);
      return null;
    }
  }

  async listParticipants(roomName: string): Promise<ParticipantInfo[]> {
    try {
      const participants = await this.roomService.listParticipants(roomName);
      logger.info(`Listed ${participants.length} participants in room ${roomName}`);
      return participants;
    } catch (error) {
      logger.error(`Failed to list participants for room ${roomName}:`, error);
      return [];
    }
  }

  async listParticipantsOrThrow(roomName: string): Promise<ParticipantInfo[]> {
    const participants = await this.roomService.listParticipants(roomName);
    logger.info(`Listed ${participants.length} participants in room ${roomName}`);
    return participants;
  }

  async removeParticipant(roomName: string, participantIdentity: string): Promise<void> {
    try {
      await this.roomService.removeParticipant(roomName, participantIdentity);
      logger.info(`Removed participant ${participantIdentity} from room ${roomName}`);
    } catch (error) {
      logger.error(`Failed to remove participant ${participantIdentity} from room ${roomName}:`, error);
      throw error;
    }
  }

  /**
   * Notify all participants in a room that the participant list has changed.
   * Updates room metadata with a version timestamp, triggering RoomMetadataChanged on all clients.
   */
  async sendParticipantsChanged(roomName: string): Promise<void> {
    try {
      const rooms = await this.roomService.listRooms([roomName]);
      if (!rooms || rooms.length === 0) {
        logger.debug(`[LiveKit] Room ${roomName} not found, skipping participants changed notification`);
        return;
      }

      const existingMetadata = parseRoomMetadata(
        roomName,
        rooms[0].metadata,
        'participants_changed',
      );
      const updatedMetadata = {
        ...existingMetadata,
        participantsVersion: Date.now(),
      };

      await this.roomService.updateRoomMetadata(roomName, JSON.stringify(updatedMetadata));
      logger.info(`[LiveKit] Sent participants changed notification for room ${roomName}`);
    } catch (error) {
      // Non-critical — don't throw, just log
      logger.warn(`[LiveKit] Failed to send participants changed for room ${roomName}:`, error);
    }
  }

  /**
   * Publish the call's active-recording state into room metadata so it is readable
   * by late joiners (LiveKit data messages aren't delivered to participants who
   * join later — H4). Pass `null` to clear when no recording is active.
   */
  async setRecordingState(
    roomName: string,
    state: { recordingId: string; startedBy: string | null; startedByName?: string | null; startedAt: number; recordingType: string } | null,
  ): Promise<void> {
    try {
      const rooms = await this.roomService.listRooms([roomName]);
      if (!rooms || rooms.length === 0) {
        logger.debug(`[LiveKit] Room ${roomName} not found, skipping recording-state update`);
        return;
      }
      const existingMetadata = rooms[0].metadata ? JSON.parse(rooms[0].metadata) : {};
      const updatedMetadata = {
        ...existingMetadata,
        activeRecording: state,
        recordingVersion: Date.now(),
      };
      await this.roomService.updateRoomMetadata(roomName, JSON.stringify(updatedMetadata));
      logger.info(`[LiveKit] Updated recording state for room ${roomName}`, { active: !!state });
    } catch (error) {
      // Non-critical — the DB row is the source of truth; this only drives the indicator.
      logger.warn(`[LiveKit] Failed to set recording state for room ${roomName}:`, error);
    }
  }

  /**
   * Tell a connected note-taker client that its backing Call row could not be
   * created. The client consumes this before the room is terminated.
   */
  async notifyRecordingStartFailure(roomName: string): Promise<void> {
    const rooms = await this.roomService.listRooms([roomName]);
    if (!rooms || rooms.length === 0) return;

    const existingMetadata = parseRoomMetadata(
      roomName,
      rooms[0].metadata,
      'recording_start_failure',
    );
    await this.roomService.updateRoomMetadata(
      roomName,
      JSON.stringify({
        ...existingMetadata,
        recordingStartFailure: true,
        recordingStartFailureVersion: Date.now(),
      }),
    );
  }

  async updateParticipantPublishSources(
    roomName: string,
    identity: string,
    allowedSources: TrackSource[],
  ): Promise<void> {
    try {
      await this.roomService.updateParticipant(roomName, identity, {
        permission: {
          canPublish: allowedSources.length > 0,
          canSubscribe: true,
          canPublishData: true,
          canPublishSources: allowedSources,
        },
      });
      logger.info(
        `[${roomName}] participant_publish_sources_updated | identity=${identity}, allowed=${allowedSources.join(',')}`,
      );
    } catch (error) {
      logger.error(
        `[${roomName}] participant_publish_sources_update_failed | identity=${identity}, error=${error}`,
      );
      throw error;
    }
  }

  /** Persist host controls into LiveKit room metadata. */
  async setRoomHostControls(roomName: string, hostControls: HostControls): Promise<boolean> {
    try {
      const rooms = await this.roomService.listRooms([roomName]);
      if (!rooms || rooms.length === 0) {
        logger.debug(`[LiveKit] Room ${roomName} not found, skipping host controls update`);
        return false;
      }

      const existingMetadata = parseRoomMetadata(roomName, rooms[0].metadata, 'host_controls');
      const updatedMetadata = {
        ...existingMetadata,
        hostControls,
        hostControlsVersion: Date.now(),
      };

      await this.roomService.updateRoomMetadata(roomName, JSON.stringify(updatedMetadata));
      logger.info(`[LiveKit] Updated host controls for room ${roomName} | ${JSON.stringify(hostControls)}`);
      return true;
    } catch (error) {
      logger.error(`[LiveKit] Failed to set host controls for room ${roomName}:`, error);
      throw error;
    }
  }

  /**
   * Publish the transcription on/off state into room metadata so late joiners see
   * it (LiveKit data messages aren't delivered to participants who join later — the
   * same H4 fix used for recording state). Present participants also react to the
   * live data-channel toggle; this is what keeps late joiners in sync.
   */
  async setRoomTranscriptionEnabled(roomName: string, enabled: boolean): Promise<void> {
    try {
      const rooms = await this.roomService.listRooms([roomName]);
      if (!rooms || rooms.length === 0) {
        logger.debug(`[LiveKit] Room ${roomName} not found, skipping transcription-state update`);
        return;
      }
      const existingMetadata = rooms[0].metadata ? JSON.parse(rooms[0].metadata) : {};
      const updatedMetadata = {
        ...existingMetadata,
        transcriptionEnabled: enabled,
        transcriptionVersion: Date.now(),
      };
      await this.roomService.updateRoomMetadata(roomName, JSON.stringify(updatedMetadata));
      logger.info(`[LiveKit] Updated transcription state for room ${roomName}`, { enabled });
    } catch (error) {
      // Non-critical — present participants already got the live toggle; this only
      // drives late-joiner sync.
      logger.warn(`[LiveKit] Failed to set transcription state for room ${roomName}:`, error);
    }
  }

  getClientUrl(): string {
    return this.clientUrl;
  }

  getServerUrl(): string {
    return this.serverUrl;
  }
}

// Export singleton instance
export const livekitService = LiveKitService.getInstance();
