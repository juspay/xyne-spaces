import { logger } from '@/utils/logger';
import { proactiveNudgeWorker, type ProactiveNudgeJobData } from '@/workers/proactiveNudgeWorker';

export interface ActivityEventTriggerPayload {
  userId: string;
  sessionId: string;
  eventCategory: string;
  eventName: string;
  eventLabel?: string;
  url: string;
  triggerType: string;
  contextMetadata?: Record<string, unknown>;
  platform: string;
  timestamp: number;
}

export async function triggerNudgesFromActivity(payload: ActivityEventTriggerPayload): Promise<void> {
  const enabled = process.env.ENABLE_PROACTIVE_NUDGE_WORKER === 'true';
  if (!enabled) {
    return;
  }

  try {
    const jobData: ProactiveNudgeJobData = {
      userId: payload.userId,
      sessionId: payload.sessionId,
      eventCategory: payload.eventCategory,
      eventName: payload.eventName,
      eventLabel: payload.eventLabel,
      url: payload.url,
      triggerType: payload.triggerType,
      contextMetadata: payload.contextMetadata,
      platform: payload.platform,
      timestamp: payload.timestamp,
    };
    await proactiveNudgeWorker.enqueue(jobData);
  } catch (error) {
    logger.error('[triggerNudgesFromActivity] Failed to enqueue nudge job', {
      eventCategory: payload.eventCategory,
      eventName: payload.eventName,
      userId: payload.userId,
      error: error,
    });
  }
}
