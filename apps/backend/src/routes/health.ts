import { Router } from 'express';
import { HealthController } from '@/controllers/healthController';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

/**
 * @route GET /api/health
 * @desc Get health status of the application (status only)
 * @access Public
 */
router.get('/', HealthController.getHealth);

/**
 * @route GET /api/health/details
 * @desc Full diagnostics: environment, uptime, memory, version, database status
 * @access Authenticated
 */
router.get('/details', authMiddleware.authenticate, HealthController.getHealthDetails);

/**
 * @route GET /api/health/readiness
 * @desc Check if the application is ready to receive traffic
 * @access Public
 */
router.get('/readiness', HealthController.getReadiness);

/**
 * @route GET /api/health/liveness
 * @desc Check if the application is alive
 * @access Public
 */
router.get('/liveness', HealthController.getLiveness);

export default router;
