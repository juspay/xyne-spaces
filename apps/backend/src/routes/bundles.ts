import { Router } from 'express';
import { BundleController } from '@/controllers/bundleController';

const router = Router();

/**
 * @route GET /api/bundles/:branchName/*
 * @desc Serve frontend bundle files from GCS based on branch/folder name.
 *       The folder is chosen by nginx (from the x_bundle_uid cookie via a
 *       userId->folder map), so this route just streams the requested folder.
 *       Falls back to the default folder when a file is missing.
 * @access Public (no auth required for serving frontend assets)
 */
router.get('/:branchName/*', (req, res) => BundleController.serveBundle(req, res));

export default router;
