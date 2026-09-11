import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getConfig,
  saveConfig,
  getSettings,
  saveSettings,
  getLatest,
  getHistory,
  getDates,
  getByDate,
  postSwitched,
  regenerate,
} from '../controllers/dailyBriefController';

const router = Router();

router.get('/config', authMiddleware.authenticate, getConfig);
router.put('/config', authMiddleware.authenticate, saveConfig);
router.get('/settings', authMiddleware.authenticate, getSettings);
router.put('/settings', authMiddleware.authenticate, saveSettings);
router.get('/latest', authMiddleware.authenticate, getLatest);
router.get('/history', authMiddleware.authenticate, getHistory);
router.get('/dates', authMiddleware.authenticate, getDates);
router.get('/by-date/:date', authMiddleware.authenticate, getByDate);
router.post('/switched', authMiddleware.authenticate, postSwitched);
router.post('/regenerate', authMiddleware.authenticate, regenerate);

export default router;
