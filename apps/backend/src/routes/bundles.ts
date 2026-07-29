import { Router } from 'express';
import { BundleController } from '@/controllers/bundleController';

const router = Router();

/**
 * @route GET /api/bundles/:branchName/*
 * @desc Serve frontend bundle files from GCS based on branch name
 * @access Public (no auth required for serving frontend assets)
 */
router.get('/:branchName/*', (req, res) => BundleController.serveBundle(req, res));

export default router;
