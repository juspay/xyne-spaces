import { Router } from 'express';
import { getLogs } from '../controllers/inspectorToolsController.js';

const router = Router();

// Grafana log querying
router.get('/logs', getLogs);

export default router;
