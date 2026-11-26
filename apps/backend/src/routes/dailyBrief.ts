import { Router } from 'express';
import { API } from '@xyne/shared';
import { authMiddleware } from '../middleware/auth';
import { api } from '@/framework/api';
import { getConfig, getSettings, saveConfig, saveSettings } from '@/handlers/dailyBrief';
import {
  getLatest,
  getHistory,
  getDates,
  getByDate,
  postSwitched,
  regenerate,
} from '../controllers/dailyBriefController';

// Typed routes (API.dailyBrief: config and settings), served by the API router behind the contract
// gate: dashboard login, then the handler.
api.routes(API.dailyBrief, (serve) => ({
  config: serve('config', { handle: ({ user, headers }) => getConfig({ user, headers }) }),
  configSet: serve('configSet', { handle: ({ body, user, headers }) => saveConfig({ body, user, headers }) }),
  settings: serve('settings', { handle: ({ user, headers }) => getSettings({ user, headers }) }),
  settingsSet: serve('settingsSet', { handle: ({ body, user, headers }) => saveSettings({ body, user, headers }) }),
}));

// Not moved yet: the briefs themselves (their text is AI-written summaries of messages).
const router = Router();

router.get('/latest', authMiddleware.authenticate, getLatest);
router.get('/history', authMiddleware.authenticate, getHistory);
router.get('/dates', authMiddleware.authenticate, getDates);
router.get('/by-date/:date', authMiddleware.authenticate, getByDate);
router.post('/switched', authMiddleware.authenticate, postSwitched);
router.post('/regenerate', authMiddleware.authenticate, regenerate);

export default router;
