import { Request, Response } from 'express';
import { DeskType } from '@xyne/shared';
import { db } from '@/database/client';
import { addChannelsDeskChannel, listChannelsDeskChannels, removeChannelsDeskChannel } from '@/channelsDesk/admin';
import { channelsDeskAppOf } from '@/channelsDesk/desk';
import { isDeskOwnerOrChannelAdmin } from '@/utils/channelMembership';
import { logger } from '../utils/logger';

/** /api/channels-desks/:channelId: a Channels desk's linked app and its channels, for desk settings. */
export class ChannelsDeskController {
  /** Desk settings are for the desk owner or a channel admin, as for desk metrics and reports. */
  private async canManageDesk(req: Request, res: Response): Promise<boolean> {
    const deskId = req.params.channelId;
    const preference = await db.emailChannelPreference.findUnique({
      where: { channelId: deskId },
      select: { ownerUserId: true, deskType: true },
    });
    if (!preference || preference.deskType !== DeskType.CHANNELS) {
      res.status(404).json({ error: 'Channels desk not found.' });
      return false;
    }
    if (!(await isDeskOwnerOrChannelAdmin(deskId, req.user!.id, preference.ownerUserId))) {
      res.status(403).json({ error: 'Only the desk owner or a channel admin can do this.' });
      return false;
    }
    return true;
  }

  get = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!(await this.canManageDesk(req, res))) return;
      res.status(200).json({ app: await channelsDeskAppOf(req.params.channelId) });
    } catch (error) {
      logger.error('[channels-desk] Failed to load desk settings', { channelId: req.params.channelId, error });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /** The app's channels on this desk, and the ones that can be added. */
  listChannels = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!(await this.canManageDesk(req, res))) return;
      res.status(200).json(await listChannelsDeskChannels(req.params.channelId));
    } catch (error) {
      logger.error('[channels-desk] Failed to list channels', { channelId: req.params.channelId, error });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  addChannel = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!(await this.canManageDesk(req, res))) return;
      const sourceChannelId = typeof req.body?.channelId === 'string' ? req.body.channelId : '';
      if (!sourceChannelId) {
        res.status(400).json({ error: 'channelId is required' });
        return;
      }
      const desk = { id: req.params.channelId, workspaceId: req.user!.workspaceId };
      if ((await addChannelsDeskChannel(desk, sourceChannelId)) !== 'added') {
        res.status(409).json({ error: "This channel can't be added: it isn't one of the app's channels, or it's already on a desk." });
        return;
      }
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[channels-desk] Failed to add channel', { channelId: req.params.channelId, error });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  removeChannel = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!(await this.canManageDesk(req, res))) return;
      if (!(await removeChannelsDeskChannel(req.params.channelId, req.params.sourceChannelId))) {
        res.status(404).json({ error: 'This channel is not on this desk.' });
        return;
      }
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[channels-desk] Failed to remove channel', { channelId: req.params.channelId, error });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const channelsDeskController = new ChannelsDeskController();
