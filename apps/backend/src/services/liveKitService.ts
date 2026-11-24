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
import { superpositionClient } from '@/services/superpositionClient';
import { CallStatus, DEFAULT_HOST_CONTROLS, normalizeHostControls, type HostControls } from '@xyne/shared';

/** Most participants a single LiveKit room can hold. Keep in sync with the LiveKit server config's room.max_participants. */
export const LIVEKIT_ROOM_MAX_PARTICIPANTS = 500;

/** Open-ended role/slot name ('default', 'test', or any future canary arm) — not a fixed enum. */
type TranscriptionAgentRole = string;
const DEFAULT_TRANSCRIPTION_AGENT_ROLE = 'default';

/**
 * Superposition config key holding every role's current agent build, as one JSON object —
 * {"default": {"agentName": "...", "url": "..."}, "test": {...}} — edited directly by
 * whoever deploys a build. A single object (not one flag per role) is what keeps roles
 * open-ended: a new canary slot is just a new key, no code change needed here.
 */
const TRANSCRIPTION_AGENT_ROLES_CONFIG_KEY = 'transcription_agent_roles';

/** How long to wait for an agent's own health check before treating it as unreachable. */
const AGENT_HEALTH_CHECK_TIMEOUT_MS = 3 * 1000;

interface ConfiguredTranscriptionAgent {
  agentName: string;
  url: string;
}

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

/** A dispatched agent claims its call session within seconds; the record only has to outlive that. */
const AGENT_DISPATCH_RECORD_TTL_SECONDS = 60 * 60;

/** How long after createDispatch we check whether any worker actually claimed the job. */
const DISPATCH_CLAIM_CHECK_DELAY_MS = 9 * 1000;

/** By then a claimed agent has fetched its session and connected (normally ~2s after claiming). */
const AGENT_JOIN_CHECK_DELAY_MS = 45 * 1000;

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
  private joinCheckTimers = new Map<string, NodeJS.Timeout>();
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
        maxParticipants: options.maxParticipants || LIVEKIT_ROOM_MAX_PARTICIPANTS,
        emptyTimeout: options.emptyTimeout || 120,
        metadata: options.metadata,
      });

      logger.info(`[${options.name}] livekit_room_created | max_participants=${options.maxParticipants || LIVEKIT_ROOM_MAX_PARTICIPANTS}, empty_timeout=${options.emptyTimeout || 120}`);
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
  async resolveAgentNameForUser(userId: string, context: { roomName?: string } = {}): Promise<string | null> {
    const tag = context.roomName ? `[${context.roomName}] ` : '';
    let role: string;
    if (config.transcriptionAgentName) {
      role = DEFAULT_TRANSCRIPTION_AGENT_ROLE;
    } else {
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
        logger.error(`${tag}transcription_agent_role_resolution_failed | userId=${userId}, error=${error}, falling_back_to=no_explicit_dispatch`);
        return null;
      }
    }

    const roleSource = config.transcriptionAgentName ? 'env' : 'superposition';
    logger.info(`${tag}transcription_agent_role_resolved | userId=${userId}, role=${role}, source=${roleSource}`);

    if (role === NO_EXPLICIT_DISPATCH) {
      logger.info(`${tag}transcription_agent_dispatch_not_applicable | userId=${userId}, reason=role_is_none`);
      return null;
    }
    return this.resolveAgentName(role, context);
  }

  /**
   * Every role's current {agentName, url}, read fresh from Superposition on every call —
   * no cache, since a stale read here just means an extra ~3s health-check timeout on an
   * already-rolled-back name, not a correctness issue. `getObjectValue` already fails
   * closed to `{}` internally on any CAC error, so no separate try/catch is needed here.
   * A deployment without Superposition sets TRANSCRIPTION_AGENT_NAME instead: one agent, as
   * the 'default' role, health-checked at the agent's own PYTHON_AGENT_URL.
   */
  private async getConfiguredAgentRoles(): Promise<Record<string, ConfiguredTranscriptionAgent>> {
    if (config.transcriptionAgentName) {
      return {
        [DEFAULT_TRANSCRIPTION_AGENT_ROLE]: {
          agentName: config.transcriptionAgentName,
          url: `${config.pythonAgentUrl.replace(/\/+$/, '')}/health`,
        },
      };
    }
    const value = await superpositionClient.getObjectValue(TRANSCRIPTION_AGENT_ROLES_CONFIG_KEY, {});
    return (value ?? {}) as unknown as Record<string, ConfiguredTranscriptionAgent>;
  }

  /**
   * Fast pre-filter, not a replacement for the ~9s post-dispatch claim-check below: a
   * bounded-timeout HTTP GET against the agent's own self-reported health. Any error,
   * non-OK response, or timeout is treated as unhealthy — erring toward trying the
   * fallback role quickly rather than dispatching to a name we already have reason to
   * doubt, since the claim-check remains the real authority regardless of which way this
   * check turns out to be wrong.
   */
  private async checkAgentHealthy(url: string, context: { roomName?: string } = {}): Promise<boolean> {
    const tag = context.roomName ? `[${context.roomName}] ` : '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AGENT_HEALTH_CHECK_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, { signal: controller.signal });
      const latencyMs = Date.now() - startedAt;
      if (response.ok) {
        logger.info(`${tag}transcription_agent_health_check_ok | url=${url}, status=${response.status}, latency_ms=${latencyMs}`);
      } else {
        logger.warn(`${tag}transcription_agent_health_check_unhealthy | url=${url}, status=${response.status}, latency_ms=${latencyMs}`);
      }
      return response.ok;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      logger.warn(`${tag}transcription_agent_health_check_failed | url=${url}, latency_ms=${latencyMs}, timed_out=${controller.signal.aborted}, error=${error}`);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Resolves which agent_name should be dispatched for a NEW call in `role`. Any
   * non-default role falls back to `DEFAULT_TRANSCRIPTION_AGENT_ROLE` when nothing
   * currently holds that slot OR the holder's health check fails — this is the only
   * fallback rule for initial resolution; a role that resolves healthy here but still
   * isn't claimable moments later is a different situation, handled by the retry loop
   * below, not by silently jumping to another role mid-attempt.
   */
  async resolveAgentName(role: TranscriptionAgentRole, context: { roomName?: string } = {}): Promise<string | null> {
    const tag = context.roomName ? `[${context.roomName}] ` : '';
    const roles = await this.getConfiguredAgentRoles();
    logger.info(`${tag}transcription_agent_roles_loaded | configured_roles=${Object.keys(roles).join(',') || 'none'}, requested_role=${role}`);

    const primary = roles[role];
    if (!primary) {
      logger.warn(`${tag}transcription_agent_role_not_configured | role=${role}`);
    } else if (await this.checkAgentHealthy(primary.url, context)) {
      logger.info(`${tag}transcription_agent_resolved | role=${role}, agent=${primary.agentName}, source=primary`);
      return primary.agentName;
    } else {
      logger.warn(`${tag}transcription_agent_primary_unhealthy | role=${role}, agent=${primary.agentName}, url=${primary.url}`);
    }

    if (role === DEFAULT_TRANSCRIPTION_AGENT_ROLE) {
      logger.error(`${tag}transcription_agent_unavailable | role=${role}, reason=default_role_unconfigured_or_unhealthy`);
      return null;
    }

    const fallback = roles[DEFAULT_TRANSCRIPTION_AGENT_ROLE];
    if (!fallback) {
      logger.error(`${tag}transcription_agent_unavailable | role=${role}, reason=no_default_fallback_configured`);
      return null;
    }

    if (await this.checkAgentHealthy(fallback.url, context)) {
      logger.info(`${tag}transcription_agent_resolved | role=${role}, agent=${fallback.agentName}, source=fallback_default`);
      return fallback.agentName;
    }

    logger.error(`${tag}transcription_agent_unavailable | role=${role}, reason=default_fallback_unhealthy, agent=${fallback.agentName}, url=${fallback.url}`);
    return null;
  }

  /** Bare explicit-dispatch call — best-effort, never throws. Returns null on failure. */
  private async dispatchTranscriptionAgent(roomName: string, agentName: string) {
    try {
      const dispatch = await this.agentDispatch.createDispatch(roomName, agentName);
      logger.info(`[${roomName}] transcription_agent_dispatched | dispatch_id=${dispatch.id}, agent=${agentName}`);
      // The agent's /session call must name a dispatch recorded here; LiveKit can't invent one.
      // An unrecorded dispatch would be refused forever, so it counts as a failed dispatch.
      if (!(await this.recordDispatch(roomName, dispatch.id))) {
        await this.agentDispatch.deleteDispatch(dispatch.id, roomName).catch(() => undefined);
        return null;
      }
      return dispatch;
    } catch (error) {
      logger.error(`[${roomName}] transcription_agent_dispatch_failed | agent=${agentName}, error=${error}`);
      return null;
    }
  }

  private async recordDispatch(roomName: string, dispatchId: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await redisService.recordAgentDispatch(dispatchId, roomName, AGENT_DISPATCH_RECORD_TTL_SECONDS);
        return true;
      } catch (error) {
        logger.error(`[${roomName}] agent_dispatch_record_failed | dispatch_id=${dispatchId}, attempt=${attempt}, error=${error}`);
      }
    }
    return false;
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

    // A claimed job can still fail to join (no call session, crash before connecting). The
    // claim check can't see that, so look for the agent in the room itself; presence-gated.
    const joinTimer = setTimeout(() => {
      this.joinCheckTimers.delete(dispatchId);
      void this.ensureTranscriptionAgent(roomName, agentName, { reason: 'dispatched_agent_not_in_room' });
    }, AGENT_JOIN_CHECK_DELAY_MS);
    joinTimer.unref?.();
    this.joinCheckTimers.set(dispatchId, joinTimer);
  }

  /** The call switched to another agent: this dispatch's join check must not bring it back. */
  private cancelJoinCheck(dispatchId: string): void {
    const timer = this.joinCheckTimers.get(dispatchId);
    if (!timer) return;
    clearTimeout(timer);
    this.joinCheckTimers.delete(dispatchId);
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

    if (claimed === null) {
      // The claim check itself failed — this says nothing about whether a worker
      // actually claimed the job (it may well have). Dispatching a second, differently-
      // named fallback agent on this guess risks two live agents in the same room, so
      // don't fast-fallback here: defer to the presence-checked redispatch path, which
      // will see the original agent is already there and no-op if so.
      logger.warn(`[${roomName}] dispatch_claim_check_indeterminate | dispatch_id=${dispatchId}, agent=${agentName}`);
      await this.ensureTranscriptionAgent(roomName, agentName, { reason: 'dispatch_claim_check_indeterminate' });
      return;
    }

    logger.error(`[${roomName}] transcription_agent_dispatch_unclaimed | dispatch_id=${dispatchId}, agent=${agentName}, allow_fallback=${allowFallback}`);

    const fallbackAgentName = allowFallback ? await this.resolveFallbackAgentName(agentName) : null;
    if (fallbackAgentName) {
      logger.error(`[${roomName}] transcription_agent_fallback_to_default | from=${agentName}, to=${fallbackAgentName}, reason=dispatch_unclaimed`);
      // The fallback arms its own checks under its own name. Drop the replaced dispatch too:
      // if its workers came back they would claim it and join next to the fallback.
      this.cancelJoinCheck(dispatchId);
      await this.agentDispatch
        .deleteDispatch(dispatchId, roomName)
        .catch((error) => logger.warn(`[${roomName}] replaced_dispatch_delete_failed | dispatch_id=${dispatchId}, error=${error}`));
      await this.dispatchFallbackAgent(roomName, fallbackAgentName);
      return;
    }

    await this.ensureTranscriptionAgent(roomName, agentName, { reason: 'dispatch_unclaimed' });
  }

  /** Null when there's nothing to fall back to (default IS the agent that just failed, or isn't configured). */
  private async resolveFallbackAgentName(failedAgentName: string): Promise<string | null> {
    const roles = await this.getConfiguredAgentRoles();
    const fallback = roles[DEFAULT_TRANSCRIPTION_AGENT_ROLE];
    if (!fallback || fallback.agentName === failedAgentName) return null;
    return fallback.agentName;
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

  /** Null means the check itself failed — genuinely unknown, not "confirmed unclaimed". */
  private async isDispatchClaimed(roomName: string, dispatchId: string): Promise<boolean | null> {
    try {
      const dispatch = await this.agentDispatch.getDispatch(dispatchId, roomName);
      const job = dispatch?.state?.jobs?.[0];
      return Boolean(job?.state?.workerId);
    } catch (error) {
      logger.warn(`[${roomName}] dispatch_claim_check_call_failed | dispatch_id=${dispatchId}, error=${error}`);
      return null;
    }
  }

  /**
   * The room's dispatches, read through the dispatch API because `listParticipants` has
   * no agent_name field. `identities`: participants that are jobs of ANY dispatch here, so
   * a transcription agent of another name (e.g. the default after a fallback) still counts
   * as present. `unclaimed`: dispatches of `agentName` no worker has picked up yet.
   */
  private async roomAgentDispatches(
    roomName: string,
    agentName: string,
  ): Promise<{ identities: Set<string>; unclaimed: string[] } | null> {
    try {
      const dispatches = await this.agentDispatch.listDispatch(roomName);
      const identities = new Set<string>();
      const unclaimed: string[] = [];
      for (const dispatch of dispatches) {
        const jobs = dispatch.state?.jobs ?? [];
        for (const job of jobs) {
          const identity = job.state?.participantIdentity;
          if (identity) identities.add(identity);
        }
        if (dispatch.agentName === agentName && !jobs.some((job) => job.state?.workerId)) {
          unclaimed.push(dispatch.id);
        }
      }
      return { identities, unclaimed };
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

      // The room can outlive its call (a rejoin before empty_timeout); the agent would get 409.
      const call = await repositories.calls.findByExternalId(roomName);
      if (!call || call.status === CallStatus.ENDED || call.status === CallStatus.CANCELLED) {
        logger.info(`[${roomName}] agent_redispatch_stopped | reason=call_not_running, status=${call?.status}, trigger=${reason}`);
        return 'room_inactive';
      }

      const participants = await this.listParticipants(roomName);
      const remaining = participants.filter((p) => p.identity !== excludeIdentity);

      if (!remaining.some(isHumanParticipant)) {
        logger.info(`[${roomName}] agent_redispatch_stopped | reason=no_human_participants, trigger=${reason}`);
        return 'no_humans';
      }

      const roomDispatches = await this.roomAgentDispatches(roomName, agentName);
      const agentStillPresent = roomDispatches
        ? remaining.some((p) => roomDispatches.identities.has(p.identity))
        : remaining.some(isAgentParticipant);

      if (agentStillPresent) {
        logger.info(`[${roomName}] agent_redispatch_stopped | reason=agent_already_present, trigger=${reason}`);
        return 'agent_present';
      }

      // Each round would otherwise leave its unclaimed dispatch behind; when workers come
      // back they'd claim all of them and several agents would join. Keep at most one.
      for (const staleId of roomDispatches?.unclaimed ?? []) {
        await this.agentDispatch
          .deleteDispatch(staleId, roomName)
          .then(() => logger.info(`[${roomName}] agent_stale_dispatch_deleted | dispatch_id=${staleId}, agent=${agentName}`))
          .catch((error) => logger.warn(`[${roomName}] agent_stale_dispatch_delete_failed | dispatch_id=${staleId}, error=${error}`));
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
