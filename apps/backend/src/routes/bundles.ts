import { Router } from 'express';
import { BundleController } from '@/controllers/bundleController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * Admin CRUD for per-user bundle overrides.
 * Must be registered BEFORE the /:branchName/* catch-all so "admin" is not
 * treated as a branch name.
 * @access Admin only
 */
router.get(
  '/admin/overrides',
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  (req, res) => BundleController.listOverrides(req, res),
);
router.post(
  '/admin/overrides',
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  (req, res) => BundleController.upsertOverride(req, res),
);
router.delete(
  '/admin/overrides/:userId',
  authMiddleware.authenticate,
  authMiddleware.requireAdmin,
  (req, res) => BundleController.deleteOverride(req, res),
);

/**
 * @route GET /api/bundles/me/*
 * @desc Serve the frontend bundle resolved for the authenticated user
 *       (per-user override if present, else the default bundle). Anonymous
 *       requests receive the default bundle.
 * @access Public (auth optional — identity, if present, selects the bundle)
 * Registered BEFORE /:branchName/* so "me" is not treated as a branch name.
 */
router.get('/me/*', authMiddleware.optionalAuthenticate, (req, res) =>
  BundleController.serveUserBundle(req, res),
);

/**
 * @route GET /api/bundles/:branchName/*
 * @desc Serve frontend bundle files from GCS based on branch name
 * @access Public (no auth required for serving frontend assets)
 */
router.get('/:branchName/*', (req, res) => BundleController.serveBundle(req, res));

export default router;
