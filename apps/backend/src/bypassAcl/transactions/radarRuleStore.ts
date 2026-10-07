import { transaction } from '../base';
import { RuleAuth, prisma, toRule } from '@/services/radar/radarRuleStore';


export function createWithinLimitTx(auth: RuleAuth, max: number, conditions: { scope: string; values: string[]; }[]) {
  return transaction(['RadarRule'], 'createWithinLimit: rule count check and rule create must commit atomically; tx is not ACL-wrapped', prisma, 
    async (tx) => {
      const count = await tx.radarRule.count({
        where: { workspaceId: auth.workspaceId, userId: auth.userId },
      });
      if (count >= max) return null;
      const row = await tx.radarRule.create({
        data: { workspaceId: auth.workspaceId, userId: auth.userId, conditions },
        select: { id: true, conditions: true },
      });
      return toRule(row);
    },
    { isolationLevel: 'Serializable' },
  );
}
