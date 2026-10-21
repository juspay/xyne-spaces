import { transaction } from '../base';
import { MAX_SKILLS_PER_USER } from '@/controllers/userSkillsController';
import { db } from '@/database/client';


export function createSkillTx(userId: string, trimmedName: any, trimmedDescription: any, trimmedInstructions: any, workspaceId: string) {
  return transaction(['UserSkill'], 'createSkill: skill-limit check plus skill insert must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const skillCount = await tx.userSkill.count({
      where: { userId },
    });

    if (skillCount >= MAX_SKILLS_PER_USER) {
      const limitError = new Error('MAX_SKILLS_REACHED');
      (limitError as any).code = 'MAX_SKILLS_REACHED';
      throw limitError;
    }

    return tx.userSkill.create({
      data: {
        userId,
        name: trimmedName,
        description: trimmedDescription,
        instructions: trimmedInstructions,
        enabled: true,
        workspaceId,
      },
    });
  });
}
