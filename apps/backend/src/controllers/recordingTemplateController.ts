import type { Request, Response } from 'express';
import { TokenVerifier } from 'livekit-server-sdk';
import { z } from 'zod';
import { config } from '@/config/env';
import { repositories } from '@/database/repositories';
import { callEncryptionService } from '@/services/callEncryptionService';
import { logger } from '@/utils/logger';

const callKeyBodySchema = z.object({
  /** The access token LiveKit egress gives the template page (its `token` query parameter). */
  token: z.string().min(1).max(8192),
});

/**
 * The recording template (dashboard recording-template.html) is the page LiveKit egress
 * opens to record an end-to-end encrypted call. Egress can't decrypt the call itself; the
 * page joins with the call key, so what egress records is decrypted media.
 */
export class RecordingTemplateController {
  private readonly verifier = new TokenVerifier(config.livekit.apiKey, config.livekit.apiSecret);

  /**
   * POST /api/recording-template/call-key
   * The call key for the egress recording an encrypted call. Only a token signed with our
   * LiveKit API secret and carrying the `recorder` grant gets it: LiveKit issues that grant to
   * egress alone, never to a participant. The call must be recording right now.
   */
  callKey = async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    const parsed = callKeyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'token is required' });
      return;
    }

    let room: string | undefined;
    try {
      const claims = await this.verifier.verify(parsed.data.token);
      if (claims.video?.recorder !== true || !claims.video.room)
        throw new Error('not a recorder token');
      room = claims.video.room;
    } catch (error) {
      logger.warn(
        `[RecordingTemplate] call_key_refused | reason=invalid_token, error=${(error as Error).message}`
      );
      res.status(403).json({ success: false, error: 'Not a recorder of this call' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(room);
      const recording = call ? await repositories.callRecordings.findActiveByCallId(call.id) : null;
      const key = call && recording ? callEncryptionService.recorderKey(call) : null;
      if (!call || !recording || !key) {
        logger.warn(
          `[RecordingTemplate] call_key_refused | room=${room}, reason=${!call ? 'no_call' : !recording ? 'not_recording' : 'no_server_key'}`
        );
        res
          .status(404)
          .json({ success: false, error: 'No encrypted recording in progress for this call' });
        return;
      }
      logger.info(
        `[RecordingTemplate] call_key_released | room=${room}, recording=${recording.id}`
      );
      res.json({ success: true, roomName: room, credentials: { key } });
    } catch (error) {
      logger.error(`[RecordingTemplate] call_key_failed | room=${room}`, error);
      res.status(500).json({ success: false, error: 'Failed to load the call key' });
    }
  };
}

export const recordingTemplateController = new RecordingTemplateController();
