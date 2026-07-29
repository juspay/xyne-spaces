import { Router } from 'express';
import multer from 'multer';
import { tmpdir } from 'os';
import { mkdirSync } from 'fs';
import { join } from 'path';
import type { Request } from 'express';
import { AccessType } from '@prisma/client';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';
import { WhatsAppBulkMigrationController } from '@/controllers/whatsappBulkMigrationController';

const router = Router();
const controller = new WhatsAppBulkMigrationController();
const whatsappMigrationAdminAuth = authorize('TICKET-MIGRATION', AccessType.ADMIN);

const uploadDir = join(tmpdir(), 'xyne-whatsapp-bulk-imports');
mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  fileFilter: (_req: Request, file, cb) => {
    const fileName = file.originalname.toLowerCase();
    if (file.fieldname === 'archives') {
      const isZip =
        fileName.endsWith('.zip') ||
        file.mimetype === 'application/zip' ||
        file.mimetype === 'application/x-zip-compressed';
      if (!isZip) {
        cb(new Error('archives must be .zip files'));
        return;
      }
      cb(null, true);
      return;
    }

    if (file.fieldname === 'mappingFile') {
      const isAllowedText =
        fileName.endsWith('.csv') ||
        fileName.endsWith('.txt') ||
        file.mimetype === 'text/csv' ||
        file.mimetype === 'text/plain' ||
        file.mimetype === 'application/vnd.ms-excel';
      if (!isAllowedText) {
        cb(new Error('mappingFile must be a .csv or .txt file'));
        return;
      }
      cb(null, true);
      return;
    }

    cb(new Error(`Unexpected file field: ${file.fieldname}`));
  },
  limits: {
    fileSize: 1024 * 1024 * 1024,
    files: 201,
  },
});

router.post(
  '/stage',
  authMiddleware.authenticate,
  whatsappMigrationAdminAuth,
  upload.fields([{ name: 'archives', maxCount: 200 }]),
  controller.stage,
);

router.post(
  '/preview',
  authMiddleware.authenticate,
  whatsappMigrationAdminAuth,
  upload.fields([{ name: 'mappingFile', maxCount: 1 }]),
  controller.preview,
);

router.post(
  '/start',
  authMiddleware.authenticate,
  whatsappMigrationAdminAuth,
  upload.fields([{ name: 'mappingFile', maxCount: 1 }]),
  controller.start,
);

export default router;
