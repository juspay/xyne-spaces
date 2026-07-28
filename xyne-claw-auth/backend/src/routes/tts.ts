import { Router, type Request, type Response } from "express";
import { synthesizeSpeech, TtsServiceError } from "../lib/azure-tts.js";

const MAX_TEXT_LENGTH = 2_000;

export const ttsRouter = Router();

interface TtsBody {
  text?: unknown;
  voice?: unknown;
}

ttsRouter.post("/", async (req: Request, res: Response) => {
  const body = req.body as TtsBody;
  if (
    typeof body.text !== "string" ||
    body.text.trim().length === 0 ||
    body.text.length > MAX_TEXT_LENGTH
  ) {
    res.status(400).json({
      success: false,
      error: `text must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters`,
    });
    return;
  }
  if (body.voice !== undefined && (typeof body.voice !== "string" || !body.voice.trim())) {
    res.status(400).json({ success: false, error: "voice must be a non-empty string" });
    return;
  }

  try {
    const data = await synthesizeSpeech(
      body.text,
      typeof body.voice === "string" ? body.voice.trim() : undefined,
    );
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof TtsServiceError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
      return;
    }
    res.status(500).json({ success: false, error: "TTS synthesis failed" });
  }
});
