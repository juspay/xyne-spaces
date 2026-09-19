import { Router } from 'express';
import { onboardingController } from '@/controllers/onboardingController';

// Desk onboarding exams — mounted at /api/onboarding (authenticated).
const router = Router();

router.get('/:channelId', onboardingController.getState);
router.post('/:channelId/topics', onboardingController.createTopic);
router.patch('/:channelId/topics/:topicId', onboardingController.updateTopic);
router.post('/:channelId/topics/:topicId/attempts', onboardingController.startAttempt);
router.post('/:channelId/attempts/:attemptId/submit', onboardingController.submit);
router.post('/:channelId/attempts/:attemptId/retry', onboardingController.retry);

export default router;
