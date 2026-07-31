import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { requireTelepresenceMonitoringCacAccess, verifyTelepresenceMonitoringSyncAuth } from './auth';
import { telepresenceMonitoringController } from './controller';

const router = Router();

// GET /api/telepresence-monitoring/health
// Authenticated + CAC-allowlisted endpoint used by the dashboard to fetch room health data.
router.get(
  '/health',
  authMiddleware.authenticate,
  requireTelepresenceMonitoringCacAccess,
  telepresenceMonitoringController.getHealth
);

// POST /api/telepresence-monitoring/health
// S2S key protected endpoint called by the telepresence service to report device health data.
router.post('/health', verifyTelepresenceMonitoringSyncAuth, telepresenceMonitoringController.reportHealth);

// GET /api/telepresence-monitoring/health/timeseries
// Authenticated + CAC-allowlisted endpoint used by the dashboard to render a time series graph from the health log.
router.get(
  '/health/timeseries',
  authMiddleware.authenticate,
  requireTelepresenceMonitoringCacAccess,
  telepresenceMonitoringController.getHealthTimeSeries
);

export default router;
