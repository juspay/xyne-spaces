import { db } from '@/database/client';

export interface AppCommand {
  id: string;
  appId: string;
  commandName: string;
  description: string;
  isForThread: boolean;
  isForChat: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertCommandInput {
  commandName: string;
  description: string;
  isForThread?: boolean;
  isForChat?: boolean;
}

export class AppCommandRepository {
  /**
   * Get all commands for a given app.
   */
  async findByAppId(appId: string): Promise<AppCommand[]> {
    return db.appCommand.findMany({
      where: { appId },
      orderBy: { commandName: 'asc' },
    });
  }

  /**
   * Get all commands available in a channel.
   * Resolves apps via ChannelParticipant (APP bot users) → InstalledApps → AppCommand.
   * Optionally filter by isForThread or isForChat.
   */
  async findByChannelId(
    channelId: string,
    filter?: { isForThread?: boolean; isForChat?: boolean },
  ): Promise<Array<AppCommand & { appId: string }>> {
    const participants = await db.channelParticipant.findMany({
      where: { channelId, user: { userType: 'APP' } },
      select: { userId: true },
    });

    if (participants.length === 0) return [];

    const userIds = participants.map((p: { userId: string }) => p.userId);
    const installations = await db.installedApps.findMany({
      where: { userId: { in: userIds } },
      select: { appId: true },
    });

    if (installations.length === 0) return [];

    const appIds = installations.map((i: { appId: string }) => i.appId);
    const where: Record<string, unknown> = { appId: { in: appIds } };
    if (filter?.isForThread !== undefined) where.isForThread = filter.isForThread;
    if (filter?.isForChat !== undefined) where.isForChat = filter.isForChat;

    return db.appCommand.findMany({
      where,
      orderBy: { commandName: 'asc' },
    }) as Promise<Array<AppCommand & { appId: string }>>;
  }

  /**
   * Create or update a command for an app.
   */
  async upsert(appId: string, input: UpsertCommandInput): Promise<AppCommand> {
    const now = new Date();
    return db.appCommand.upsert({
      where: { appId_commandName: { appId, commandName: input.commandName } },
      create: {
        appId,
        commandName: input.commandName,
        description: input.description,
        isForThread: input.isForThread ?? true,
        isForChat: input.isForChat ?? true,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        description: input.description,
        ...(input.isForThread !== undefined && { isForThread: input.isForThread }),
        ...(input.isForChat !== undefined && { isForChat: input.isForChat }),
        updatedAt: now,
      },
    });
  }

  /**
   * Delete a specific command by app + name.
   */
  async deleteByAppIdAndName(appId: string, commandName: string): Promise<void> {
    await db.appCommand.deleteMany({ where: { appId, commandName } });
  }

  /**
   * Find the installed app that owns a command in a channel.
   * Resolves via ChannelParticipant (APP bot users) → InstalledApps → Apps → AppCommand.
   * Used when dispatching a command to know which webhook to call.
   */
  async findCommandWithInstalledApp(channelId: string, commandName: string) {
    const participants = await db.channelParticipant.findMany({
      where: { channelId, user: { userType: 'APP' } },
      select: { userId: true },
    });

    if (participants.length === 0) return null;

    const userIds = participants.map((p: { userId: string }) => p.userId);

    const installation = await db.installedApps.findFirst({
      where: {
        userId: { in: userIds },
        app: { commands: { some: { commandName } } },
      },
      include: {
        app: {
          include: {
            commands: { where: { commandName }, take: 1 },
          },
        },
      },
    });

    if (!installation) return null;

    const command = installation.app.commands[0];
    if (!command) return null;

    return {
      appId: installation.appId,
      appUserId: installation.userId,
      webhookUrl: installation.webhookUrl ?? null,
      command,
    };
  }
}
