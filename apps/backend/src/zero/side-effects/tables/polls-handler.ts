import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { pollLifecycleQueue } from '@/queues/pollLifecycleQueue';
import { logger } from '@/utils/logger';

export class PollsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { entityId: pollId } = job;

    const poll = await db.poll.findUnique({
      where: { id: pollId },
      select: { id: true, closesAt: true, remindAt: true, closedAt: true },
    });

    if (!poll || poll.closedAt || (!poll.closesAt && !poll.remindAt)) {
      return;
    }

    await pollLifecycleQueue.schedulePoll(poll);

    logger.info('[POLLS-SIDE-EFFECT] Enqueued poll lifecycle jobs', { pollId });
  }
}
