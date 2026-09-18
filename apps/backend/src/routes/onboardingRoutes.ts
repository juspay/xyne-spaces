import { Router } from 'express';
import { onboardingController } from '@/controllers/onboardingController';

// Desk onboarding exams — mounted at /api/onboarding (authenticated).
const router = Router();

router.get('/:channelId', onboardingController.getState);
router.get('/:channelId/search-tickets', onboardingController.searchTickets);
router.post('/:channelId/topics', onboardingController.createTopic);
router.patch('/:channelId/topics/:topicId', onboardingController.updateTopic);
router.put('/:channelId/topics/:topicId/tickets', onboardingController.setTopicTickets);
router.post('/:channelId/topics/:topicId/attempts', onboardingController.startAttempt);
router.get(
  '/:channelId/attempts/:attemptId/tickets/:paperTicketId/email',
  onboardingController.getTicketEmail
);
router.put('/:channelId/attempts/:attemptId/draft', onboardingController.saveDraft);
router.post('/:channelId/attempts/:attemptId/submit', onboardingController.submit);
router.get('/:channelId/attempts/:attemptId/review', onboardingController.getReview);

export default router;
