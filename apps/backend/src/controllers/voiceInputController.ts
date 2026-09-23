import { Request, Response } from 'express';
import axios from 'axios';
import { voiceInputService } from '@/services/voiceInputService';
import { telephonyEmailService } from '@/services/ozonetel/telephonyEmailService';
import { logger } from '@/utils/logger';

// Not a Google Speech-to-Text hard limit (BatchRecognize accepts much larger GCS objects) —
// just a sane app-level safety cap on what we'll download/stage server-side per request.
const MAX_RECORDING_SIZE_BYTES = 200 * 1024 * 1024; // 200MB

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

  transcribeRecording = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const emailId = typeof req.body?.emailId === 'string' ? req.body.emailId : undefined;
      if (!emailId) {
        res.status(400).json({ success: false, error: 'emailId is required' });
        return;
      }

      const language = typeof req.body?.language === 'string' ? req.body.language : undefined;

      const recording = await telephonyEmailService.getCallRecording(emailId, user.workspaceId);
      if (!recording) {
        res.status(404).json({ success: false, error: 'No recording found for this call' });
        return;
      }

      logger.info(
        `[VoiceInputController] Transcribing call recording | user=${user.id} | emailId=${emailId}`,
      );

      let recordingResponse;
      try {
        recordingResponse = await axios.get(recording.recordingUrl, {
          responseType: 'arraybuffer',
          timeout: 120_000,
          maxContentLength: MAX_RECORDING_SIZE_BYTES,
          maxBodyLength: MAX_RECORDING_SIZE_BYTES,
        });
      } catch (downloadError) {
        if (
          axios.isAxiosError(downloadError) &&
          (downloadError.code === 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED' ||
            downloadError.message?.includes('maxContentLength'))
        ) {
          res.status(413).json({ success: false, error: 'Recording too large to transcribe (max 25 MB)' });
          return;
        }
        throw downloadError;
      }

      const buffer = Buffer.from(recordingResponse.data as ArrayBuffer);
      if (buffer.byteLength > MAX_RECORDING_SIZE_BYTES) {
        res.status(413).json({ success: false, error: 'Recording too large to transcribe (max 25 MB)' });
        return;
      }

      const contentType =
        (recordingResponse.headers['content-type'] as string | undefined) || 'audio/mpeg';

      const transcript = await voiceInputService.transcribeWithGoogleStt(
        { buffer, fileName: `${emailId}-recording`, mimeType: contentType },
        { language },
      );

      logger.info(
        `[VoiceInputController] Recording transcribed | user=${user.id} | emailId=${emailId}` +
          ` | chars=${transcript.text.length} | language=${transcript.language ?? 'unknown'}`,
      );

      res.status(200).json({
        success: true,
        text: transcript.text,
        language: transcript.language,
      });
    } catch (error) {
      logger.error('[VoiceInputController] Failed to transcribe call recording:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to transcribe recording',
      });
    }
  };
}

export const voiceInputController = new VoiceInputController();
