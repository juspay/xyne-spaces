import { Router } from 'express';
import { FEATURE_ANNOUNCEMENT_LIMITS } from '@xyne/shared';
import { authMiddleware } from '@/middleware/auth';
import { validateZod } from '@/middleware/validation';
import { uploadSingle } from '@/middleware/upload';
import {
  createFeatureAnnouncementSchema,
  dismissFeatureAnnouncementsSchema,
  seenFeatureAnnouncementSchema,
  updateFeatureAnnouncementSchema,
} from '@/validators/featureAnnouncementValidator';
import {
  dismissAnnouncements,
  getPendingAnnouncements,
  markAnnouncementCtaClicked,
  markAnnouncementSeen,
  streamAnnouncementMedia,
  streamAnnouncementMediaForAdmin,
} from '@/controllers/featureAnnouncementController';
import {
  archiveAnnouncement,
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
  publishAnnouncement,
  updateAnnouncement,
  uploadAnnouncementMedia,
} from '@/controllers/featureAnnouncementAdminController';

const router = Router();

/**
 * Admin routes use `requireAdminOrOwner`, not `requireAdmin`. The latter compares against
 * a lowercase 'admin' while a browser session carries the uppercase WorkspaceRole from the
 * database, so it rejects every human administrator.
 */
const requireAdmin = [authMiddleware.authenticate, authMiddleware.requireAdminOrOwner];

// Admin routes are declared first so a literal `/admin` segment can never be captured by
// the `/:id` patterns below it.
router.get('/admin', requireAdmin, listAnnouncements);
router.post(
  '/admin',
  requireAdmin,
  validateZod(createFeatureAnnouncementSchema),
  createAnnouncement
);
router.post(
  '/admin/media',
  requireAdmin,
  uploadSingle({ fieldName: 'media', maxBytes: FEATURE_ANNOUNCEMENT_LIMITS.MAX_IMAGE_BYTES }),
  uploadAnnouncementMedia
);
router.get('/admin/:id', requireAdmin, getAnnouncement);
router.get('/admin/:id/media/:index', requireAdmin, streamAnnouncementMediaForAdmin);
router.put(
  '/admin/:id',
  requireAdmin,
  validateZod(updateFeatureAnnouncementSchema),
  updateAnnouncement
);
router.post('/admin/:id/publish', requireAdmin, publishAnnouncement);
router.post('/admin/:id/archive', requireAdmin, archiveAnnouncement);

router.get('/pending', authMiddleware.authenticate, getPendingAnnouncements);
router.post(
  '/dismiss',
  authMiddleware.authenticate,
  validateZod(dismissFeatureAnnouncementsSchema),
  dismissAnnouncements
);
router.post(
  '/:id/seen',
  authMiddleware.authenticate,
  validateZod(seenFeatureAnnouncementSchema),
  markAnnouncementSeen
);
router.post('/:id/cta', authMiddleware.authenticate, markAnnouncementCtaClicked);
router.get('/:id/media/:index', authMiddleware.authenticate, streamAnnouncementMedia);

export default router;
