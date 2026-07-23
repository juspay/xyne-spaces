import { DatabaseClient } from '../client';

export class CallMessageRepository {
  async create(data: {
    callId: string;
    participantId: string;
    message: string;
  }) {
    const db = DatabaseClient.getInstance();
    const call = await db.call.findUniqueOrThrow({
      where: { id: data.callId },
      select: { workspaceId: true },
    });

    return db.callMessage.create({
      data: {
        callId: data.callId,
        workspaceId: call.workspaceId,
        participantId: data.participantId,
        message: data.message,
      },
    });
  }

  async getByCallId(callId: string, opts?: { limit?: number; before?: string }) {
    const limit = opts?.limit ?? 100;
    const db = DatabaseClient.getInstance();

    const messages = await db.callMessage.findMany({
      where: {
        callId,
        ...(opts?.before ? { createdAt: { lt: new Date(opts.before) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    if (messages.length === 0) return [];

    // Collect unique participantIds to resolve display names
    const participantIds = [...new Set(messages.map(m => m.participantId))];

    // Look up participants by userId (= LiveKit identity for both internal & external)
    const participants = await db.callParticipant.findMany({
      where: {
        callId,
        userId: { in: participantIds },
      },
      select: { id: true, userId: true, displayName: true, isExternal: true },
    });

    // Resolve internal user names
    const internalUserIds = participants
      .filter(p => !p.isExternal)
      .map(p => p.userId);

    let userNameMap = new Map<string, string>();
    if (internalUserIds.length > 0) {
      const users = await db.user.findMany({
        where: { id: { in: internalUserIds } },
        select: { id: true, name: true, displayName: true },
      });
      userNameMap = new Map(users.map(u => [u.id, u.displayName || u.name]));
    }

    // Build participantId -> { displayName, isExternal } map
    const participantMap = new Map<string, { displayName: string; isExternal: boolean }>();
    for (const p of participants) {
      const name = p.isExternal
        ? (p.displayName || 'Guest')
        : (userNameMap.get(p.userId) || 'Unknown');
      participantMap.set(p.userId, { displayName: name, isExternal: p.isExternal });
    }

    return messages.map(m => ({
      ...m,
      displayName: participantMap.get(m.participantId)?.displayName || 'Unknown',
      isExternal: participantMap.get(m.participantId)?.isExternal ?? false,
    }));
  }
}
