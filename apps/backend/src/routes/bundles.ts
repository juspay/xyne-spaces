import { Router } from 'express';
import { BundleController } from '@/controllers/bundleController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * Admin CRUD for per-user bundle overrides.
 * Registered BEFORE the /:branchName/* catch-all so "admin" isn't treated as a
 * branch name.
 * @access Workspace/org ADMIN or OWNER. Scoped to the caller's workspace: the
 *         tenant ACL layer auto-filters list/update/delete to req.user's
 *         workspace, and upsert additionally rejects a target user in another
 *         workspace.
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
 * @route GET /api/bundles/me/*
 * @desc Serve the frontend bundle resolved for the authenticated user. The
 *       userId is taken from the VERIFIED JWT (optionalAuthenticate); the
 *       backend maps it to an override folder or the default. nginx proxies all
 *       normal bundle traffic here, so the JWT (sent as the app's auth cookie/
 *       bearer) is validated server-side — the folder choice can't be spoofed.
 * @access Public (auth optional — a valid token selects the user's bundle,
 *         otherwise the default is served)
 * Registered BEFORE /:branchName/* so "me" isn't treated as a branch name.
 */
router.get('/me/*', authMiddleware.optionalAuthenticate, (req, res) =>
  BundleController.serveUserBundle(req, res),
);

/**
 * @route GET /api/bundles/:branchName/*
 * @desc Serve frontend bundle files from GCS for an explicit folder (used by the
 *       devqa User-Agent path in nginx). Falls back to the default folder when a
 *       file is missing.
 * @access Public (no auth required for serving frontend assets)
 */
router.get('/:branchName/*', (req, res) => BundleController.serveBundle(req, res));

export default router;
