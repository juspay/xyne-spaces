import { Router } from 'express';
import multer, { MulterError } from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { voiceInputController } from '@/controllers/voiceInputController';

const router = Router();
const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — mirrors controller validation
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_SIZE_BYTES } });

router.post(
  '/transcribe',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('audio')(req, res, err => {
      if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ success: false, error: 'Audio file too large (max 10 MB)' });
        return;
      }
      next(err);
    });
  },
  voiceInputController.transcribe,
);

export default router;
