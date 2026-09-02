import { DatabaseClient } from '@/database/client';
import { PrismaClient, TranscriptionAgent } from '@prisma/client';

/**
 * Roles are open-ended slot names, not a fixed enum — new slots (e.g. a third canary
 * arm) need zero code changes, just a rollout call naming a new role string. `'default'`
 * is the one slot that's assumed to always have an active row: every other role falls
 * back to it when unassigned or unclaimed (see resolveAgentName/liveKitService).
 */
export type TranscriptionAgentRole = string;
export const DEFAULT_TRANSCRIPTION_AGENT_ROLE = 'default';

export class TranscriptionAgentRepository {
  private db: PrismaClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  /** The current active holder of `role` — the hot-path lookup, runs on every call. */
  async getActive(role: TranscriptionAgentRole): Promise<TranscriptionAgent | null> {
    return this.db.transcriptionAgent.findFirst({
      where: { role, status: 'active' },
    });
  }

  async list(): Promise<TranscriptionAgent[]> {
    return this.db.transcriptionAgent.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Assign `agentName` to `role`, demoting whoever currently holds it. Callers must
   * verify `agentName` is actually live (see liveKitService.verifyAgentLive) BEFORE
   * calling this — this method does the DB write only, atomically. Always inserts a
   * fresh row; inactive rows are frozen history and never reactivated.
   */
  async rollout(agentName: string, role: TranscriptionAgentRole): Promise<TranscriptionAgent> {
    return this.db.$transaction(async (tx) => {
      await tx.transcriptionAgent.updateMany({
        where: { role, status: 'active' },
        data: { status: 'inactive' },
      });
      return tx.transcriptionAgent.create({
        data: { agentName, role, status: 'active' },
      });
    });
  }
}
