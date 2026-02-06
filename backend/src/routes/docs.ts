import express from 'express';
import multer from 'multer';
import { docsController } from '@/controllers/docsController.js';
import { authMiddleware } from '@/middleware/auth.js';

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('Only zip files are allowed'));
        }
    },
});

// XYNE-1287: All docs routes require authentication
router.post('/publish', authMiddleware.authenticate, upload.single('docs'), docsController.publishDocs);

router.get('/check/*', authMiddleware.authenticate, docsController.checkExistingDoc);

router.get('/all', authMiddleware.authenticate, docsController.getAllDocs);

router.get('/zip/*', authMiddleware.authenticate, docsController.getDocsZip);

router.get('/share-targets', authMiddleware.authenticate, docsController.getShareTargets);

router.post('/share', authMiddleware.authenticate, docsController.shareDoc);

router.post('/setup-quarto-access', authMiddleware.authenticate, docsController.setupQuartoAccess);

router.delete('/:docId', authMiddleware.authenticate, docsController.deleteDoc);

export default router;
