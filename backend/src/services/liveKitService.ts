import {
  RoomServiceClient,
  AccessToken,
  TrackSource,
  TwirpError,
  type ParticipantInfo,
} from 'livekit-server-sdk';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { DEFAULT_HOST_CONTROLS, type HostControls } from '@xyne/shared';

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

export function allowedSourcesFor(hostControls: HostControls): TrackSource[] {
  const allowed: TrackSource[] = [];
  if (!hostControls.lockMic) allowed.push(TrackSource.MICROPHONE);
  if (!hostControls.lockCamera) allowed.push(TrackSource.CAMERA);
  if (!hostControls.lockScreenShare) {
    allowed.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }
  return allowed;
}

export function hasActiveLock(hostControls: HostControls): boolean {
  return hostControls.lockMic || hostControls.lockCamera || hostControls.lockScreenShare;
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

  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return DEFAULT_HOST_CONTROLS;
  }

  const controls = stored as Partial<Record<keyof HostControls, unknown>>;
  return {
    lockMic:
      typeof controls.lockMic === 'boolean' ? controls.lockMic : DEFAULT_HOST_CONTROLS.lockMic,
    lockCamera:
      typeof controls.lockCamera === 'boolean'
        ? controls.lockCamera
        : DEFAULT_HOST_CONTROLS.lockCamera,
    lockScreenShare:
      typeof controls.lockScreenShare === 'boolean'
        ? controls.lockScreenShare
        : DEFAULT_HOST_CONTROLS.lockScreenShare,
  };
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

  /** Persist host-control locks into LiveKit room metadata. */
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

  getClientUrl(): string {
    return this.clientUrl;
  }

  getServerUrl(): string {
    return this.serverUrl;
  }
}

// Export singleton instance
export const livekitService = LiveKitService.getInstance();
