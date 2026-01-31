import multer from 'multer';
import { logger } from '../utils/logger';
// Common multer configuration for file uploads
export const uploadConfig = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB max file size
    files: 10 // Max 10 files per request
  },
  // fileFilter: (_req, file, cb) => {
  //   // Allowed file types
  //   const allowedMimeTypes = [
  //     // Images
  //     'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  //     // Videos
  //     'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm',
  //     // Documents
  //     'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  //     'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  //     'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  //     'text/plain', 'text/csv',
  //     // Archives
  //     'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'
  //   ];

  //   if (allowedMimeTypes.includes(file.mimetype)) {
  //     cb(null, true);
  //   } else {
  //     cb(new Error(`File type ${file.mimetype} is not allowed`));
  //   }
  // }
});

// Export different upload configurations
export const uploadSingle = uploadConfig.single('file');

// Custom uploadMultiple with minimal logging
export const uploadMultiple = (req: any, res: any, next: any) => {
  logger.info('fixingAttachment 🗂️ [MULTER] Starting multipart form processing...');

  const multerMiddleware = uploadConfig.fields([
    { name: 'files', maxCount: 10 },
    { name: 'thumbnails', maxCount: 10 }
  ]);

  multerMiddleware(req, res, (err: any) => {
    if (err) {
      logger.error('fixingAttachment ❌ [MULTER] Upload middleware error:', err.message);
      return next(err);
    }
    // Log Multer storage results
    const reqFiles = req.files as { [fieldname: string]: Express.Multer.File[] } || {};
    const files = reqFiles['files'] || [];
    const thumbnails = reqFiles['thumbnails'] || [];

    logger.info(`fixingAttachment 💾 [MULTER] Files stored in memory: ${files.length} files, ${thumbnails.length} thumbnails`);

    // Log individual files stored in memory
    files.forEach((file: Express.Multer.File, index: number) => {
      logger.info(`fixingAttachment 📁 [MULTER] File ${index + 1} stored: ${file.originalname} (${file.buffer?.length || 0} bytes in memory)`);
    });

    thumbnails.forEach((thumbnail: Express.Multer.File, index: number) => {
      logger.info(`fixingAttachment 🖼️ [MULTER] Thumbnail ${index + 1} stored: ${thumbnail.originalname} (${thumbnail.buffer?.length || 0} bytes in memory)`);
    });

    logger.info('fixingAttachment ✅ [MULTER] All files successfully stored in memory buffers');

    next();
  });
};
