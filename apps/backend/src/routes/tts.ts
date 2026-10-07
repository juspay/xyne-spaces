import { Router, type Request, type Response } from 'express';
import { synthesizeSpeech } from '@/services/clawAgentService';
import { isElevenLabsTtsConfigured, synthesizeWithElevenLabs } from '@/services/elevenLabsTts';
import { getElevenLabsVoices, isElevenLabsVoiceId } from '@/services/elevenLabsVoices';
import { logger } from '@/utils/logger';

const router = Router();
const MAX_TEXT_LENGTH = 2000;

router.get('/voices', (_req: Request, res: Response) => {
  // Empty when ElevenLabs TTS is off, so clients have nothing to pick from.
  const data = isElevenLabsTtsConfigured()
    ? getElevenLabsVoices()
    : { voices: [], defaultVoiceId: '' };
  res.json({ success: true, data });
});

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as { text?: unknown; voice?: unknown };
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({
      success: false,
      error: `text must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters`,
    });
    return;
  }
  if (body.voice !== undefined && (typeof body.voice !== 'string' || !body.voice.trim())) {
    res.status(400).json({ success: false, error: 'voice must be a non-empty string' });
    return;
  }
  const voice = typeof body.voice === 'string' ? body.voice.trim() : undefined;
  // A listed ElevenLabs voice id picks that voice; anything else is an Azure voice name.
  const elevenLabsVoice = voice && isElevenLabsVoiceId(voice) ? voice : undefined;
  if (isElevenLabsTtsConfigured()) {
    try {
      const data = await synthesizeWithElevenLabs(body.text, elevenLabsVoice);
      res.json({ success: true, data });
      return;
    } catch (error) {
      // Never log the text; fall back to the Azure path so voice keeps working.
      logger.warn(
        `[TTS] ElevenLabs synthesis failed, falling back to Azure: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }
  try {
    const data = await synthesizeSpeech({
      text: body.text,
      ...(voice && !elevenLabsVoice ? { voice } : {}),
    });
    res.json({ success: true, data });
  } catch {
    res.status(502).json({ success: false, error: 'TTS synthesis failed' });
  }
});

export default router;
