import { CommandType, CommandAccessibility, Prisma } from '@prisma/client';
import { db } from '@/database/client';

export { CommandType, CommandAccessibility };

export class CommandNameConflictError extends Error {
  readonly code = 'COMMAND_NAME_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'CommandNameConflictError';
  }
}

/** Thrown by update() when no command/shortcut with the given name exists for the app. */
export class CommandNotFoundError extends Error {
  readonly code = 'COMMAND_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'CommandNotFoundError';
  }
}

export interface AppCommand {
  id: string;
  appId: string;
  commandName: string;
  description: string;
  commandType: CommandType;
  commandAccessibility: CommandAccessibility;
  /** @deprecated use commandAccessibility */
  isForThread?: boolean | null;
  /** @deprecated use commandAccessibility */
  isForChat?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppCommandWithApp extends AppCommand {
  appName: string;
}

export interface UpsertCommandInput {
  commandName: string;
  description: string;
  commandType: CommandType;
  commandAccessibility: CommandAccessibility;
}

export class AppCommandRepository {
  /**
   * Get all commands (or shortcuts) for a given app.
   * commandType is required — caller must specify COMMAND or SHORTCUT.
   */
  async findByAppId(appId: string, commandType: CommandType): Promise<AppCommand[]> {
    return db.appCommand.findMany({
      where: { appId, commandType },
      orderBy: { commandName: 'asc' },
    });
  }

  /**
   * Get the INSTALL's frozen command/shortcut snapshot (installed_app_commands) for one install.
   * Read-only — the Installed edit screen shows these; they refresh only via Update (re-install).
   */
  // Returns the install-snapshot rows as-is (installed_app_commands has installedAppId +
  // sourceCommandId instead of appId, and no isForChat/isForThread). Read-only display only.
  async findInstalledByInstalledAppId(installedAppId: string, commandType: CommandType) {
    return db.installedAppCommand.findMany({
      where: { installedAppId, commandType },
      orderBy: { commandName: 'asc' },
    });
  }

  /**
   * Get all commands available in a channel.
   * Resolves apps via ChannelParticipant (APP bot users) → InstalledApps → AppCommand.
   * commandType is required — prevents accidentally mixing commands and shortcuts.
   * Optionally filter by commandAccessibility.
   */
  async findByChannelId(
    channelId: string,
    filter: { commandType: CommandType; commandAccessibility?: CommandAccessibility },
  ): Promise<Array<AppCommand & { appId: string }>> {
    const participants = await db.channelParticipant.findMany({
      where: { channelId, user: { userType: 'APP' } },
      select: { userId: true },
    });

    if (participants.length === 0) return [];

    const userIds = participants.map((p: { userId: string }) => p.userId);

    const installations = await db.installedApps.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, appId: true },
    });

    if (installations.length === 0) return [];

    const appIdByInstall = new Map(installations.map(i => [i.id, i.appId]));
    const where: Record<string, unknown> = {
      installedAppId: { in: installations.map(i => i.id) },
      commandType: filter.commandType,
    };
    if (filter.commandAccessibility !== undefined) {
      const acc = filter.commandAccessibility;
      // BOTH commands are visible in every context; include them alongside the requested type
      const matchValues: CommandAccessibility[] =
        acc === CommandAccessibility.CHAT || acc === CommandAccessibility.THREAD
          ? [acc, CommandAccessibility.BOTH]
          : [acc];
      where.commandAccessibility = { in: matchValues };
    }

    const rows = await db.installedAppCommand.findMany({
      where,
      orderBy: { commandName: 'asc' },
    });
    return rows.map(r => ({
      id: r.sourceCommandId,
      appId: appIdByInstall.get(r.installedAppId) as string,
      commandName: r.commandName,
      description: r.description,
      commandType: r.commandType,
      commandAccessibility: r.commandAccessibility,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Get all shortcuts available in a channel, including app name.
   * commandType is required.
   */
  async findByChannelIdWithAppName(
    channelId: string,
    filter: { commandType: CommandType; commandAccessibility?: CommandAccessibility },
  ): Promise<AppCommandWithApp[]> {
    const participants = await db.channelParticipant.findMany({
      where: { channelId, user: { userType: 'APP' } },
      select: { userId: true },
    });

    if (participants.length === 0) return [];

    const userIds = participants.map((p: { userId: string }) => p.userId);
    // Frozen snapshot (installed_app_commands), not the live template — see findByChannelId.
    const installations = await db.installedApps.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, appId: true, app: { select: { name: true } } },
    });

    if (installations.length === 0) return [];

    const metaByInstall = new Map(
      installations.map(i => [i.id, { appId: i.appId, appName: i.app.name }]),
    );
    const where: Record<string, unknown> = {
      installedAppId: { in: installations.map(i => i.id) },
      commandType: filter.commandType,
    };
    if (filter.commandAccessibility !== undefined) {
      const acc = filter.commandAccessibility;
      // BOTH commands are visible in every context; include them alongside the requested type
      const matchValues: CommandAccessibility[] =
        acc === CommandAccessibility.CHAT || acc === CommandAccessibility.THREAD
          ? [acc, CommandAccessibility.BOTH]
          : [acc];
      where.commandAccessibility = { in: matchValues };
    }

    const rows = await db.installedAppCommand.findMany({
      where,
      orderBy: { commandName: 'asc' },
    });

    return rows.map(r => {
      const meta = metaByInstall.get(r.installedAppId);
      return {
        id: r.sourceCommandId,
        appId: meta?.appId ?? '',
        commandName: r.commandName,
        description: r.description,
        commandType: r.commandType,
        commandAccessibility: r.commandAccessibility,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        appName: meta?.appName ?? '',
      };
    });
  }

  /**
   * Create a brand-new command/shortcut for an app.
   * Rejects with CommandNameConflictError if the name is already taken — by a command
   * OR a shortcut — since names are unique per app. Adding never overwrites an existing
   * row (that silent overwrite was the bad UX). Mirrors appsRepository.createApp.
   */
  async create(appId: string, input: UpsertCommandInput): Promise<AppCommand> {
    const now = new Date();

    const existing = await db.appCommand.findUnique({
      where: { appId_commandName: { appId, commandName: input.commandName } },
    });
    if (existing) {
      throw this.nameConflict(existing.commandType, input.commandName);
    }

    try {
      return await db.appCommand.create({
        data: {
          appId,
          commandName: input.commandName,
          description: input.description,
          commandType: input.commandType,
          commandAccessibility: input.commandAccessibility,
          createdAt: now,
          updatedAt: now,
        },
      });
    } catch (error) {
      // A concurrent request inserted the same (appId, commandName) between our
      // findUnique above and this create — the DB unique constraint rejects it (P2002).
      // Surface the same friendly conflict instead of leaking a raw Prisma error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await db.appCommand.findUnique({
          where: { appId_commandName: { appId, commandName: input.commandName } },
        });
        if (raced) {
          throw this.nameConflict(raced.commandType, input.commandName);
        }
      }
      throw error;
    }
  }

  /**
   * Update an existing command/shortcut, matched by (appId, commandName).
   * Throws CommandNotFoundError if no such row exists, or CommandNameConflictError if a
   * row with that name exists but is of a different type (a command vs a shortcut).
   */
  async update(appId: string, input: UpsertCommandInput): Promise<AppCommand> {
    const existing = await db.appCommand.findUnique({
      where: { appId_commandName: { appId, commandName: input.commandName } },
    });
    if (!existing) {
      throw new CommandNotFoundError(
        `No ${input.commandType.toLowerCase()} named "${input.commandName}" exists for this app.`,
      );
    }
    if (existing.commandType !== input.commandType) {
      throw this.nameConflict(existing.commandType, input.commandName);
    }
    return db.appCommand.update({
      where: { id: existing.id },
      data: {
        description: input.description,
        commandAccessibility: input.commandAccessibility,
        updatedAt: new Date(),
      },
    });
  }

  private nameConflict(existingType: CommandType, commandName: string): CommandNameConflictError {
    return new CommandNameConflictError(
      `A ${existingType.toLowerCase()} named "${commandName}" already exists for this app. ` +
        `Command and shortcut names must be unique within an app.`,
    );
  }

  /**
   * Delete a specific command/shortcut by app + name + type.
   * commandType is required to avoid accidentally deleting both a command and shortcut with the same name.
   */
  async deleteByAppIdNameAndType(
    appId: string,
    commandName: string,
    commandType: CommandType,
  ): Promise<void> {
    await db.appCommand.deleteMany({ where: { appId, commandName, commandType } });
  }

  /**
   * Find the installed app that owns a command/shortcut in a channel.
   * Resolves via ChannelParticipant (APP bot users) → InstalledApps → Apps → AppCommand.
   * commandType is required — prevents accidentally matching a shortcut when dispatching a command.
   */
  async findCommandWithInstalledApp(
    channelId: string,
    commandName: string,
    commandType: CommandType,
  ) {
    const participants = await db.channelParticipant.findMany({
      where: { channelId, user: { userType: 'APP' } },
      select: { userId: true },
    });

    if (participants.length === 0) return null;

    const userIds = participants.map((p: { userId: string }) => p.userId);

    // Match against the install's FROZEN snapshot (installed_app_commands), not the live template,
    // so dispatch honors the version each workspace actually installed.
    const installation = await db.installedApps.findFirst({
      where: {
        userId: { in: userIds },
        installedAppCommands: { some: { commandName, commandType } },
      },
      include: {
        installedAppCommands: { where: { commandName, commandType }, take: 1 },
      },
    });

    if (!installation) return null;

    const command = installation.installedAppCommands[0];
    if (!command) return null;

    return {
      appId: installation.appId,
      appUserId: installation.userId,
      webhookUrl: installation.webhookUrl ?? null,
      command,
    };
  }
}
