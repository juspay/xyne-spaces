/**
 * Resolves the ExternalSource backing a desk channel.
 *
 * Channel-bound desks (regular EMAIL / Slack / App) store their source with
 * `channelId` set. DL desks have no channel-bound source — they rely on the
 * workspace shared mailbox, a single `ExternalSource` with `channelId: null`
 * + `workspaceId` + `sourceType: 'google'|'microsoft'`. This fallback
 * resolves it via the channel's EmailChannelPreference (`deskType === DL` +
 * `workspaceId`).
 *
 * Shared by the send/reply (EmailController) and attachment-upload
 * (ZohoUploadController) paths so they can't drift apart.
 */

import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { DeskType } from '@xyne/shared';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { logger } from '@/utils/logger';

export class ChannelExternalSourceResolver {
  private externalSourceRepo = new ExternalSourceRepository();
  private emailChannelPreferenceRepo = new EmailChannelPreferenceRepository();

  /**
   * Resolve the external source for a channel, falling back to the
   * workspace shared mailbox for DL desks. Returns null when no source
   * backs the channel (caller should surface a 404).
   */
  async resolveForChannel(channelId: string) {
    const source = await this.externalSourceRepo.findChannelSource(channelId, {
      sourceTypes: ['google', 'microsoft', 'zoho'],
    });
    if (source) {
      return source;
    }
    const preference = await this.emailChannelPreferenceRepo.findByChannelId(channelId);
    if (preference?.deskType === DeskType.DL && preference.workspaceId) {
      const wsSource = await this.externalSourceRepo.findEmailSourceByWorkspaceId(preference.workspaceId);
      return wsSource;
    }
    logger.warn('[ChannelExternalSourceResolver] No external source found for channel', { channelId });
    return null;
  }
}
