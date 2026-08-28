import { Router } from 'express';
import { BundleController } from '@/controllers/bundleController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * Admin CRUD for per-user bundle overrides.
 * Registered BEFORE /version so "admin" isn't ambiguous.
 * @access Workspace/org ADMIN or OWNER. Scoped to the caller's workspace.
 */
router.get(
  '/admin/overrides',
  authMiddleware.authenticate,
  authMiddleware.requireAdminOrOwner,
  (req, res) => BundleController.listOverrides(req, res),
);
router.post(
  '/admin/overrides',
  authMiddleware.authenticate,
  authMiddleware.requireAdminOrOwner,
  (req, res) => BundleController.upsertOverride(req, res),
);
router.delete(
  '/admin/overrides/:userId',
  authMiddleware.authenticate,
  authMiddleware.requireAdminOrOwner,
  (req, res) => BundleController.deleteOverride(req, res),
);

/**
 * @route GET /api/bundles/version
 * @desc Resolve which bundle (version or folder) the authenticated user should
 *       get. nginx calls this (forwarding the user's auth cookie) to decide what
 *       to stream from GCS. userId is taken from the VERIFIED JWT; no override /
 *       anonymous / invalid token => the baked default version.
 * @access Public (auth optional — a valid token selects the user's bundle)
 */
router.get('/version', authMiddleware.optionalAuthenticate, (req, res) =>
  BundleController.getVersion(req, res),
);

export default router;
