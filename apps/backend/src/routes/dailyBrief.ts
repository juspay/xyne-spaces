import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getLatest,
  getHistory,
  getDates,
  getByDate,
  postSwitched,
  regenerate } from '../controllers/dailyBriefController';
// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


// Not moved yet: the briefs themselves (their text is AI-written summaries of messages).
const router = Router();

router.get('/latest', authMiddleware.authenticate, getLatest);
router.get('/history', authMiddleware.authenticate, getHistory);
router.get('/dates', authMiddleware.authenticate, getDates);
router.get('/by-date/:date', authMiddleware.authenticate, getByDate);
router.post('/switched', authMiddleware.authenticate, postSwitched);
router.post('/regenerate', authMiddleware.authenticate, regenerate);

export default router;
