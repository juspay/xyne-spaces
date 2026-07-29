import { Request, Response } from 'express';
import { voiceInputService } from '@/services/voiceInputService';
import { logger } from '@/utils/logger';

const ALLOWED_AUDIO_TYPES = [
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/webm',
  'video/webm',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
];

const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export class VoiceInputController {
  transcribe = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: 'No audio file provided' });
        return;
      }

      if (!ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {
        res.status(400).json({
          success: false,
          error: `Unsupported audio format: ${file.mimetype}`,
        });
        return;
      }

      if (file.size > MAX_AUDIO_SIZE_BYTES) {
        res.status(413).json({
          success: false,
          error: 'Audio file too large (max 10 MB)',
        });
        return;
      }

      const language = typeof req.body?.language === 'string' ? req.body.language : undefined;

      // hints: JSON-encoded string[] of workspace user display names for STT keyword boosting
      let hints: string[] | undefined;
      if (typeof req.body?.hints === 'string' && req.body.hints) {
        try {
          const parsed: unknown = JSON.parse(req.body.hints);
          if (Array.isArray(parsed)) {
            hints = (parsed as unknown[]).filter((h): h is string => typeof h === 'string');
          }
        } catch {
          // malformed hints — transcription proceeds without them
        }
      }

      logger.info(
        `[VoiceInputController] Transcribing | user=${userId} | size=${(file.size / 1024).toFixed(1)}KB` +
          ` | mime=${file.mimetype} | language=${language ?? '(default)'} | hints=${hints?.length ?? 0}`,
      );

      const transcript = await voiceInputService.transcribeAudio(file, { language, hints });

      logger.info(
        `[VoiceInputController] Success | user=${userId} | chars=${transcript.text.length}` +
          ` | language=${transcript.language ?? 'unknown'}`,
      );
      res.status(200).json({
        success: true,
        text: transcript.text,
        language: transcript.language,
        durationS: transcript.duration_s,
      });
    } catch (error) {
      logger.error('[VoiceInputController] Failed to transcribe voice input:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to transcribe audio',
      });
    }
  };
}

export const voiceInputController = new VoiceInputController();
