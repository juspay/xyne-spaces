import { Router, type Request, type Response } from 'express';
import { synthesizeSpeech } from '@/services/clawAgentService';

const router = Router();
const MAX_TEXT_LENGTH = 2000;

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
  try {
    const data = await synthesizeSpeech({
      text: body.text,
      ...(typeof body.voice === 'string' ? { voice: body.voice.trim() } : {}),
    });
    res.json({ success: true, data });
  } catch {
    res.status(502).json({ success: false, error: 'TTS synthesis failed' });
  }
});

export default router;
