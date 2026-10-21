import { Router, type Request, type Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { generateChatTitle, type ChatTitleInput } from "../chat-title.js";

const router = Router();

router.post(
  "/internal/chat-title/generate",
  validateS2SKey,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Partial<ChatTitleInput> | undefined;
    if (!body || typeof body.firstUserMessage !== "string" || !body.firstUserMessage.trim()) {
      res.status(400).json({ success: false, error: "firstUserMessage is required" });
      return;
    }
    if (body.assistantReply !== undefined && typeof body.assistantReply !== "string") {
      res.status(400).json({ success: false, error: "assistantReply must be a string" });
      return;
    }

    const title = await generateChatTitle({
      firstUserMessage: body.firstUserMessage.slice(0, 4_000),
      ...(body.assistantReply ? { assistantReply: body.assistantReply.slice(0, 4_000) } : {}),
    });

    res.json({ success: true, title });
  },
);

export { router as chatTitleRouter };
