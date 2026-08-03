import { Request, Response } from 'express';
import { RoomMemberStatus, RoomRole, RoomStatus } from '@xyne/shared';
import { db } from '../database/client';
import { config } from '@/config/env';
import { roomCurationQueue } from '@/queues/roomCurationQueue';
import { logger } from '@/utils/logger';

export class RoomController {
  private async assertRoomAccess(
    roomId: string,
    userId: string,
    res: Response
  ): Promise<{ id: string; status: string } | null> {
    const room = await db.room.findUnique({
      where: { id: roomId },
      select: { id: true, status: true },
    });
    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return null;
    }
    const membership = await db.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { status: true, role: true },
    });
    const isManager =
      membership?.status === RoomMemberStatus.APPROVED && membership.role === RoomRole.OWNER;
    if (!isManager) {
      res.status(403).json({ error: 'Only the room owner can manage curation' });
      return null;
    }
    return { id: room.id, status: room.status };
  }

  async curateRoom(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { roomId } = req.params;
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }

      const room = await this.assertRoomAccess(roomId, userId, res);
      if (!room) return;
      if (room.status !== RoomStatus.ACTIVE) {
        res.status(409).json({ error: 'Room is not active' });
        return;
      }

      // The queue being reachable is not enough - without a worker consuming it the job
      // would sit in Redis forever while the UI reported it as queued.
      if (!config.roomCuration.enabled || !roomCurationQueue.isReady) {
        res.status(503).json({ error: 'Curation is temporarily unavailable' });
        return;
      }

      const queued = await roomCurationQueue.enqueueRoom(roomId, true);
      res.status(202).json({ queued });
    } catch (error) {
      logger.error('[ROOM-CONTROLLER] Failed to enqueue curation:', error);
      res.status(500).json({ error: 'Failed to queue curation' });
    }
  }
}
