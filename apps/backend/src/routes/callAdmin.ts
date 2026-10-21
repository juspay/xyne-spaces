import { RequestHandler, Router } from 'express';
import multer from 'multer';
import { callAdminController } from '@/controllers/callAdminController';
import { workspaceScopedRoute } from '@/database/tenant/context';
import { normalizeMulterError } from '@/middleware/upload';
import {
  MAX_BACKGROUND_BYTES,
  callBackgroundController,
} from '@/controllers/callBackgroundController';

const router = Router();

// The panel acts on calls the caller may not be on (SCRIBE:ADMIN sees the whole
// workspace), so it runs at workspace scope instead of under the per-user call ACL.
// callAdminAccessService checks every request's relation to the call instead.
router.use(workspaceScopedRoute);

router.get('/calls', callAdminController.listCalls);
router.get('/series', callAdminController.listSeries);

router.post('/series/:seriesId/cancel', callAdminController.cancelSeries);

router.post('/calls/:callId/cancel', callAdminController.cancelCall);
router.post('/calls/:callId/force-end', callAdminController.forceEnd);
router.post('/calls/:callId/unlink-transcript', callAdminController.unlinkTranscript);
router.post('/calls/:callId/reprocess-transcript', callAdminController.reprocessTranscript);
router.post('/calls/:callId/regenerate-summary', callAdminController.regenerateSummary);
router.post('/calls/:callId/owner', callAdminController.changeOwner);

// Call background images (preset list itself is edited in Superposition).
const parseBackgroundUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BACKGROUND_BYTES, files: 2 },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'thumb', maxCount: 1 },
]);
// Map multer limit errors to 400/413 instead of letting them surface as a 500.
const backgroundUpload: RequestHandler = (req, res, next) =>
  parseBackgroundUpload(req, res, (err?: unknown) =>
    err ? next(normalizeMulterError(err, MAX_BACKGROUND_BYTES)) : next()
  );
router.post('/backgrounds', backgroundUpload, callBackgroundController.upload);

export default router;
