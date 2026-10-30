import type { Call, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  CallOrigin,
  CallStatus,
  CallType,
  InvitationResponse,
  MEETING_PLATFORM_LABELS,
  parseMeetingLink,
  type MeetingPlatform,
} from '@xyne/shared';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { AppError } from '@/middleware/errorHandler';
import {
  addMeetNotetakerParticipant,
  findInFlightMeetNotetakerCall,
  findMeetNotetakerCall,
  findMeetNotetakerSenderName,
  updateMeetNotetakerCallAsCreator,
} from '@/bypassAcl/meetNotetakerServices';
import { livekitService, LIVEKIT_ROOM_MAX_PARTICIPANTS } from '@/services/liveKitService';
import { noteTakerWebhookController } from '@/controllers/noteTakerWebhookController';
import { logger } from '@/utils/logger';

/**
 * Xyne Automatic notetaker for Google Meet and Microsoft Teams.
 *
 * A user pastes a meeting link; we create a regular VIDEO Call (callOrigin MEET_LINK)
 * and ask the meet-bot service (apps/meet-bot) to join it in Chrome. Once the bot is
 * admitted it asks us for a LiveKit room, publishes the meeting's audio into it, and
 * the transcription agent plus the note-taker pipeline (see usesNoteTakerPipeline)
 * produce the transcript, summary and labels on that Call.
 *
 * Call.status stays SCHEDULED while the bot is still getting in: an ACTIVE call with
 * no LiveKit room would be ended by callValidationWorker. The bot's own progress
 * lives on Call.metadata.meetBot.
 */

export const MEET_BOT_IDENTITY_PREFIX = 'meet-bot-';
// Long enough for the bot to reconnect to LiveKit during a long meeting.
const MEET_BOT_TOKEN_TTL = '6h';

export type MeetBotStatus = 'requested' | 'joining' | 'waiting_room' | 'in_call' | 'ended' | 'failed';
const BOT_REPORTED_STATUSES: readonly MeetBotStatus[] = ['joining', 'waiting_room', 'in_call', 'ended', 'failed'];

export interface MeetBotMetadata {
  status: MeetBotStatus;
  /** Which meeting app; calls from before Teams support have none (Google Meet). */
  platform?: MeetingPlatform;
  meetingCode: string;
  reason?: string;
  message?: string;
  updatedAt: string;
}

/** A meeting participant the bot heard speaking (their tile id + name in the meeting UI). */
export interface MeetSpeaker {
  key: string;
  name: string;
}

export interface MeetBotStatusEvent {
  status: MeetBotStatus;
  reason?: string | undefined;
  message?: string | undefined;
}

function metadataOf(call: Pick<Call, 'metadata'>): Record<string, unknown> {
  return call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
    ? (call.metadata as Record<string, unknown>)
    : {};
}

export function meetBotOf(call: Pick<Call, 'metadata'>): MeetBotMetadata | null {
  const meetBot = metadataOf(call).meetBot;
  return meetBot && typeof meetBot === 'object' ? (meetBot as MeetBotMetadata) : null;
}

export function isMeetBotStatus(value: unknown): value is MeetBotStatus {
  return typeof value === 'string' && (BOT_REPORTED_STATUSES as readonly string[]).includes(value);
}

function withMeetBot(call: Pick<Call, 'metadata'>, patch: Partial<MeetBotMetadata>, extra: Record<string, unknown> = {}) {
  const current = meetBotOf(call);
  const meetBot = { ...current, ...patch, updatedAt: new Date().toISOString() };
  return { ...metadataOf(call), ...extra, meetBot } as Prisma.InputJsonValue;
}

const isInFlight = (call: Call) => call.status === CallStatus.SCHEDULED || call.status === CallStatus.ACTIVE;

class MeetNotetakerService {
  get enabled(): boolean {
    return !!config.meetBot.url && !!config.meetBot.apiKey;
  }

  private botRequest() {
    return axios.create({
      baseURL: config.meetBot.url.replace(/\/+$/, ''),
      headers: { 'x-api-key': config.meetBot.apiKey },
      timeout: 15_000,
    });
  }

  /**
   * Sends the bot into the Meet, or — when it is already in or on its way to that Meet
   * (one bot per Meet per workspace) — adds the user to that call instead and says who
   * sent it.
   */
  async sendToMeeting(input: {
    userId: string;
    workspaceId: string;
    meetingUrl: string;
    /** Call title; defaults to "<platform> (<code>)", e.g. "Google Meet (abc-defg-hij)". */
    title?: string | null;
    /** Extra Call.metadata, e.g. the calendar event an auto-join came from. */
    metadata?: Record<string, unknown>;
  }): Promise<{ call: Call; alreadySentBy: { userId: string; name: string | null } | null }> {
    if (!this.enabled) throw new AppError('The Meet notetaker is not enabled', 503);
    const meeting = parseMeetingLink(input.meetingUrl);
    if (!meeting) {
      throw new AppError('Paste a Google Meet or Microsoft Teams link, like https://meet.google.com/abc-defg-hij', 400);
    }

    const existing = await findInFlightMeetNotetakerCall(input.workspaceId, meeting.url);
    if (existing) {
      if (await this.isSessionRunning(existing.externalId)) {
        if (existing.createdByUserId !== input.userId) {
          await addMeetNotetakerParticipant(existing, input.userId);
        }
        const name = await findMeetNotetakerSenderName(existing.createdByUserId);
        return { call: existing, alreadySentBy: { userId: existing.createdByUserId, name } };
      }
      // The bot lost this session (restart, crash) without reporting back: close it
      // out so a fresh bot can be sent.
      await updateMeetNotetakerCallAsCreator(existing, {
        status: CallStatus.ENDED,
        endedAt: new Date(),
        metadata: withMeetBot(existing, { status: 'failed', reason: 'bot_restarted' }),
      });
    }

    const now = new Date();
    const call = await db.call.create({
      data: {
        id: uuidv4(),
        externalId: uuidv4(),
        workspaceId: input.workspaceId,
        createdByUserId: input.userId,
        callType: CallType.VIDEO,
        callOrigin: CallOrigin.MEET_LINK,
        status: CallStatus.SCHEDULED,
        title: input.title?.trim() || `${MEETING_PLATFORM_LABELS[meeting.platform]} (${meeting.code})`,
        roomLink: meeting.url,
        startsAt: now,
        lastActivityAt: now,
        metadata: {
          ...input.metadata,
          meetBot: {
            status: 'requested',
            platform: meeting.platform,
            meetingCode: meeting.code,
            updatedAt: now.toISOString(),
          },
        } satisfies Record<string, unknown> as Prisma.InputJsonValue,
      },
    });
    // The Calls lists only show calls the viewer participates in.
    await repositories.calls.createParticipant({
      id: uuidv4(),
      callId: call.id,
      userId: input.userId,
      invitedBy: input.userId,
      invitedAt: now,
      response: InvitationResponse.ACCEPTED,
      respondedAt: now,
    });

    try {
      await this.botRequest().post('/sessions', {
        sessionId: call.externalId,
        meetingUrl: meeting.url,
        callbackUrl: `${config.backendUrl.replace(/\/+$/, '')}/api/meet-bot/sessions/${call.externalId}`,
      });
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      logger.error(`[${call.externalId}] meet_bot_dispatch_failed`, { status, error: String(error) });
      await db.call.update({
        where: { id: call.id },
        data: {
          status: CallStatus.ENDED,
          endedAt: new Date(),
          metadata: withMeetBot(call, { status: 'failed', reason: status === 503 ? 'bot_busy' : 'bot_unreachable' }),
        },
      });
      throw new AppError(
        status === 503 ? 'All notetaker bots are busy, try again in a minute' : 'Could not reach the notetaker bot',
        503,
      );
    }

    logger.info(`[${call.externalId}] meet_bot_requested`, { platform: meeting.platform, meetingCode: meeting.code, userId: input.userId });
    return { call, alreadySentBy: null };
  }

  /**
   * Whether the bot can take another meeting now. Lets automatic sends wait for a free
   * slot instead of leaving a "bots busy" call behind; true when the bot doesn't say.
   */
  async hasCapacity(): Promise<boolean> {
    try {
      const { data } = await this.botRequest().get<{ activeSessions?: number; maxSessions?: number }>('/health');
      return typeof data.activeSessions !== 'number' || typeof data.maxSessions !== 'number'
        ? true
        : data.activeSessions < data.maxSessions;
    } catch {
      return false;
    }
  }

  /** Whether the bot is still working on this session; it forgets sessions when it restarts. */
  private async isSessionRunning(sessionId: string): Promise<boolean> {
    try {
      const { data } = await this.botRequest().get<{ status: string }>(`/sessions/${encodeURIComponent(sessionId)}`);
      return data.status !== 'ended' && data.status !== 'failed';
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return false;
      throw new AppError('Could not reach the notetaker bot', 503);
    }
  }

  /** Asks the bot to leave. The call ends through the bot's status callback or the room closing. */
  async stop(input: { userId: string; callExternalId: string }): Promise<Call> {
    const call = await repositories.calls.findByExternalId(input.callExternalId);
    if (!call || call.callOrigin !== CallOrigin.MEET_LINK || call.createdByUserId !== input.userId) {
      throw new AppError('Notetaker call not found', 404);
    }
    if (!isInFlight(call)) return call;
    await this.botRequest()
      .delete(`/sessions/${encodeURIComponent(call.externalId)}`)
      .catch((error: unknown) => {
        // A bot that already forgot the session can't be in the meeting anymore.
        if (axios.isAxiosError(error) && error.response?.status === 404) return;
        throw new AppError('Could not reach the notetaker bot', 503);
      });
    return call;
  }

  // ---- Callbacks from the bot (x-api-key auth, no user session) ----

  private async findBotCall(externalId: string): Promise<Call> {
    const call = await findMeetNotetakerCall(externalId);
    if (!call || call.callOrigin !== CallOrigin.MEET_LINK) throw new AppError('Notetaker call not found', 404);
    return call;
  }

  async handleBotStatus(externalId: string, event: MeetBotStatusEvent): Promise<void> {
    const call = await this.findBotCall(externalId);
    const patch: Partial<MeetBotMetadata> = {
      status: event.status,
      ...(event.reason ? { reason: event.reason } : {}),
      ...(event.message ? { message: event.message.slice(0, 500) } : {}),
    };
    const data: Prisma.CallUpdateInput = { metadata: withMeetBot(call, patch), lastActivityAt: new Date() };

    const botLeft = event.status === 'ended' || event.status === 'failed';
    // A bot that never got a room leaves nothing for the LiveKit webhooks to end.
    if (botLeft && call.status === CallStatus.SCHEDULED) {
      data.status = CallStatus.ENDED;
      data.endedAt = new Date();
    }
    await updateMeetNotetakerCallAsCreator(call, data);
    logger.info(`[${externalId}] meet_bot_status`, { status: event.status, reason: event.reason });

    // With a room, end the call now rather than when LiveKit closes the empty room
    // (~30 s later, after its departure timeout). Same path as room_finished, which
    // then finds the call already ended.
    if (botLeft && call.status === CallStatus.ACTIVE) {
      await noteTakerWebhookController.finishCall(call.externalId);
    }
  }

  /**
   * The bot was admitted: create the call's LiveKit room (with the transcription agent)
   * and give the bot a token to publish the meeting's audio. Idempotent, so a bot that
   * reconnects gets a fresh token for the same room.
   */
  async startBotRoom(externalId: string, speaker?: MeetSpeaker): Promise<{ livekitUrl: string; token: string }> {
    const call = await this.findBotCall(externalId);
    if (!isInFlight(call)) throw new AppError('This notetaker call has already ended', 409);

    const roomName = call.externalId;
    const platform = meetBotOf(call)?.platform ?? 'google_meet';
    if (speaker) return this.speakerToken(call, speaker, platform);
    if (call.status === CallStatus.SCHEDULED || !(await livekitService.getRoomInfo(roomName))) {
      const agentName = await livekitService.resolveAgentNameForUser(call.createdByUserId, { roomName });
      await livekitService.createRoom({
        name: roomName,
        maxParticipants: LIVEKIT_ROOM_MAX_PARTICIPANTS,
        emptyTimeout: 120,
        metadata: JSON.stringify({
          callType: CallType.VIDEO,
          callOrigin: CallOrigin.MEET_LINK,
          sttModel: 'google',
          createdBy: call.createdByUserId,
          workspaceId: call.workspaceId,
          ...(agentName && { agentName }),
        }),
      });
      if (agentName) {
        await livekitService.dispatchTranscriptionAgentForCall(roomName, agentName);
      } else {
        logger.error(`[${roomName}] transcription_agent_dispatch_skipped | reason=no_active_agent_name_configured`);
      }
      const now = new Date();
      await updateMeetNotetakerCallAsCreator(call, {
        status: CallStatus.ACTIVE,
        startedAt: call.startedAt ?? now,
        lastActivityAt: now,
        // The note-taker pipeline shows a summary shimmer while this is pending.
        metadata: withMeetBot(call, { status: 'in_call' }, { detailedSummaryStatus: 'pending' }),
      });
    }

    const token = await livekitService.generateAccessToken({
      userIdentity: `${MEET_BOT_IDENTITY_PREFIX}${call.id}`,
      userName: MEETING_PLATFORM_LABELS[platform],
      roomName,
      ttl: MEET_BOT_TOKEN_TTL,
      metadata: JSON.stringify({ source: platform }),
    });
    return { livekitUrl: livekitService.getServerUrl(), token };
  }

  /**
   * A token for one meeting speaker: the bot publishes each speaker's audio as its own
   * LiveKit participant, named after them, so the transcript carries their name.
   * The room must already exist (the default participant creates it).
   */
  private async speakerToken(
    call: Call,
    speaker: MeetSpeaker,
    platform: MeetingPlatform,
  ): Promise<{ livekitUrl: string; token: string }> {
    if (call.status !== CallStatus.ACTIVE) throw new AppError('The notetaker is not in the meeting yet', 409);
    const speakerId = createHash('sha256').update(speaker.key).digest('hex').slice(0, 12);
    const token = await livekitService.generateAccessToken({
      userIdentity: `${MEET_BOT_IDENTITY_PREFIX}${call.id}-${speakerId}`,
      userName: speaker.name,
      roomName: call.externalId,
      ttl: MEET_BOT_TOKEN_TTL,
      metadata: JSON.stringify({ source: platform, meetSpeaker: true }),
    });
    return { livekitUrl: livekitService.getServerUrl(), token };
  }
}

export const meetNotetakerService = new MeetNotetakerService();
