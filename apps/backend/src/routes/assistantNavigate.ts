import { Router } from 'express';
import { validate } from '../middleware/validation';
import { assistantNavigateLimiter } from '../middleware/rateLimiters';
import {
  assistantNavigateChooseBodySchema,
  assistantNavigateStepBodySchema,
} from '../validators/assistantNavigateValidator';
import {
  assistantNavigateChooseHandler,
  assistantNavigateStepHandler,
} from '../services/assistantNavigate/handler';

const router = Router();

router.post(
  '/step',
  assistantNavigateLimiter,
  validate(assistantNavigateStepBodySchema),
  assistantNavigateStepHandler
);

router.post(
  '/choose',
  assistantNavigateLimiter,
  validate(assistantNavigateChooseBodySchema),
  assistantNavigateChooseHandler
);

export default router;
