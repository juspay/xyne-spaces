import { RoomServiceClient, AccessToken } from 'livekit-server-sdk';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

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
      
      logger.info(`LiveKit room created: ${options.name}`);
    } catch (error) {
      logger.error('Failed to create LiveKit room:', error);
      throw error;
    }
  }

  async generateAccessToken(options: LiveKitTokenOptions): Promise<string> {
    try {
      const at = new AccessToken(this.apiKey, this.apiSecret, {
        identity: options.userIdentity,
        name: options.userName,
        ttl: options.ttl || '10m',
      });

      at.addGrant({
        roomJoin: true,
        room: options.roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const token = await at.toJwt();
      logger.info(`Generated LiveKit token for user ${options.userIdentity} in room ${options.roomName}`);
      return token;
    } catch (error) {
      logger.error('Failed to generate LiveKit token:', error);
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

  async listParticipants(roomName: string): Promise<any[]> {
    try {
      const participants = await this.roomService.listParticipants(roomName);
      logger.info(`Listed ${participants.length} participants in room ${roomName}`);
      return participants;
    } catch (error) {
      logger.error(`Failed to list participants for room ${roomName}:`, error);
      return [];
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
