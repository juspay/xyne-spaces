import { db } from '@/database/client';
import type { ProactiveNudgeOutputLenient } from '@/services/nudges/proactiveNudgeSchemas';

const MAX_NUDGES_PER_MESSAGE = 1;

export class ProactiveNudgeService {
  async persistForMessage(messageId: string, output: ProactiveNudgeOutputLenient): Promise<void> {
    const rawNudges = output.nudges ?? [];
    const nudges = rawNudges.slice(0, MAX_NUDGES_PER_MESSAGE);
    const primaryNudge = nudges[0];

    await db.$transaction(async (tx) => {
      if (primaryNudge) {
        await tx.proactiveNudge.upsert({
          where: { messageId },
          create: {
            messageId,
            type: primaryNudge.type,
            priority: primaryNudge.priority,
            title: primaryNudge.title,
            description: primaryNudge.description,
            evidenceSpans: primaryNudge.evidence_spans,
            actions: {
              suggestedActions: primaryNudge.suggested_actions ?? [],
            },
          },
          update: {},
        });
      }

      const activeNudgeCount = await tx.proactiveNudge.count({
        where: {
          messageId,
          state: 'ACTIVE',
        },
      });

      const message = await tx.message.findUnique({ where: { messageId } });
      if (message) {
        await tx.message.update({
          where: { messageId },
          data: { nudgeCount: activeNudgeCount },
        });
      }
    });
  }
}

export const proactiveNudgeService = new ProactiveNudgeService();
