import { Request, Response } from 'express';
import {
  assistantNavigateChooseBodySchema,
  assistantNavigateStepBodySchema,
} from '@/validators/assistantNavigateValidator';
import {
  navigateChoose,
  navigateStep,
  type NavigateChooseInput,
  type NavigateStepInput,
} from './index';

// Always 200 once validated: a Jev failure is `{ status: 'unavailable' }`, never a 5xx.
export const assistantNavigateStepHandler = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  if (!workspaceId) {
    res.status(403).json({ success: false, error: 'Forbidden: workspace context required' });
    return;
  }

  const abandoned = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abandoned.abort();
  });

  // `validate` only checks the body; this pass fills in the schema's defaults and trims.
  const input = assistantNavigateStepBodySchema.validate(req.body).value as NavigateStepInput;
  const result = await navigateStep(input, { userId, workspaceId }, abandoned.signal);
  if (abandoned.signal.aborted) return;
  res.json(result);
};

// Same contract as the step handler: always 200 once validated.
export const assistantNavigateChooseHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  if (!workspaceId) {
    res.status(403).json({ success: false, error: 'Forbidden: workspace context required' });
    return;
  }

  const abandoned = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abandoned.abort();
  });

  const input = assistantNavigateChooseBodySchema.validate(req.body).value as NavigateChooseInput;
  const result = await navigateChoose(input, { userId, workspaceId }, abandoned.signal);
  if (abandoned.signal.aborted) return;
  res.json(result);
};
