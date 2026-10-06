import type { RadarRule } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { createWithinLimitTx } from '@/bypassAcl/transactions/radarRuleStore';

export const prisma = DatabaseClient.getInstance();

/**
 * A reader's own rules, read and written only as themselves.
 *
 * Every method takes the caller's auth and scopes on (workspaceId, userId)
 * rather than on the row id alone. An id is guessable and a rule decides what
 * somebody sees, so "the row exists" is never sufficient grounds to touch it.
 */
export interface RuleAuth {
  userId: string;
  workspaceId: string;
}

interface RuleRow {
  id: string;
  conditions: unknown;
}

/** Retries of a serializable create that lost a write race. One is enough: the
 *  loser re-reads a count that has moved by exactly one. */
const RULE_WRITE_RETRIES = 2;

export const toRule = (row: RuleRow): RadarRule => ({
  id: row.id,
  conditions: (Array.isArray(row.conditions) ? row.conditions : []) as RadarRule['conditions'],
});

class RadarRuleStore {
  async list(auth: RuleAuth): Promise<RadarRule[]> {
    const rows = await prisma.radarRule.findMany({
      where: { workspaceId: auth.workspaceId, userId: auth.userId },
      select: { id: true, conditions: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRule);
  }

  /**
   * Counted and inserted in one serializable transaction, so two tabs saving at
   * once cannot both read 49 and both write. Serializable is what makes the
   * count a real precondition rather than a guess that was true a moment ago;
   * Postgres answers a lost race with a serialization failure, which is retried
   * here because the loser's count is simply stale rather than wrong.
   *
   * Returns null at the limit — the caller turns that into a 409.
   */
  async createWithinLimit(
    auth: RuleAuth,
    conditions: Array<{ scope: string; values: string[] }>,
    max: number,
  ): Promise<RadarRule | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await createWithinLimitTx(auth, max, conditions);
      } catch (error) {
        // P2034 is the write conflict / deadlock Serializable is there to
        // raise. Anything else is a real failure and belongs to the caller.
        const code = (error as { code?: string }).code;
        if (code !== 'P2034' || attempt >= RULE_WRITE_RETRIES) throw error;
      }
    }
  }

  /** Guarded updateMany, not update-by-id: the where clause carries the owner,
   *  so a rule id belonging to somebody else matches nothing and returns null
   *  rather than being written. */
  async update(
    auth: RuleAuth,
    ruleId: string,
    conditions: Array<{ scope: string; values: string[] }>,
  ): Promise<RadarRule | null> {
    const { count } = await prisma.radarRule.updateMany({
      where: { id: ruleId, workspaceId: auth.workspaceId, userId: auth.userId },
      data: { conditions },
    });
    if (count === 0) return null;
    return toRule({ id: ruleId, conditions });
  }

  async remove(auth: RuleAuth, ruleId: string): Promise<boolean> {
    const { count } = await prisma.radarRule.deleteMany({
      where: { id: ruleId, workspaceId: auth.workspaceId, userId: auth.userId },
    });
    return count > 0;
  }
}

export const radarRuleStore = new RadarRuleStore();

