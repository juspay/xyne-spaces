import type { ExternalSource } from '@prisma/client';
import { ExternalSourceRepository, db, encrypt } from '../../re-exports';
import type { MessageSource, Pair } from '../types';

/** ExternalSource CONNECTION rows and the message-map rows shared with self-serve migration. */
export class SourceRepository {
  private readonly sources = new ExternalSourceRepository();

  async findById(id: string): Promise<ExternalSource | null> {
    return await this.sources.findById(id);
  }

  async findByName(name: string): Promise<ExternalSource | null> {
    return await this.sources.findByName(name);
  }

  async findActiveConfig(workspaceId: string, sourceType: string): Promise<ExternalSource | null> {
    return await db.externalSource.findFirst({
      where: { workspaceId, sourceType, recordType: 'CONNECTION', isActive: true },
    });
  }

  /**
   * The link's message-map rows: `sourceId` (created if missing) takes new rows; `sourceIds` adds any
   * older migration's history for this channel, read so nothing is copied twice.
   */
  async findMessageScopes(
    source: MessageSource,
    legacyNames: string[],
    link: Pair
  ): Promise<{ sourceId: string; sourceIds: string[] }> {
    const rows = await db.externalSource.findMany({
      where: { name: { in: [source.name, ...legacyNames] }, channelId: link.spacesId },
      select: { id: true, name: true },
    });
    const own = rows.find((row) => row.name === source.name);
    const sourceId = own?.id ?? (await this.ensureMessageSource(source, link));
    const legacyIds = rows.filter((row) => row !== own).map((row) => row.id);
    return { sourceId, sourceIds: [sourceId, ...legacyIds] };
  }

  async findActiveNames(names: string[]): Promise<Set<string>> {
    if (names.length === 0) return new Set();
    const rows = await db.externalSource.findMany({
      where: { name: { in: names }, isActive: true },
      select: { name: true },
    });
    return new Set(rows.map((row) => row.name));
  }

  async createConfig(data: {
    name: string;
    sourceType: string;
    displayName: string;
    externalWorkspaceId: string;
    credentials: string;
    description: string | null;
    workspaceId: string;
    createdBy: string;
  }): Promise<ExternalSource> {
    return await db.externalSource.create({
      data: {
        recordType: 'CONNECTION',
        name: data.name,
        sourceType: data.sourceType,
        displayName: data.displayName,
        credentials: data.credentials,
        description: data.description,
        workspaceId: data.workspaceId,
        externalIdentifier: data.externalWorkspaceId,
        createdBy: data.createdBy,
      },
    });
  }

  async update(
    id: string,
    data: {
      credentials?: string;
      displayName?: string;
      description?: string | null;
      isActive?: boolean;
    }
  ): Promise<void> {
    await this.sources.update(id, data);
  }

  /** The link's message-map source; `refresh` re-saves Mirror's credentials on it (file downloads use them). */
  async ensureMessageSource(source: MessageSource, link: Pair, refresh = false): Promise<string> {
    const existing = await this.sources.findByName(source.name);
    if (existing && existing.isActive && !refresh) return existing.id;

    const credentials = encrypt(JSON.stringify(source.credentials));
    if (existing) {
      await this.sources.update(existing.id, { credentials, isActive: true });
      return existing.id;
    }
    const created = await this.sources.create({
      name: source.name,
      sourceType: source.sourceType,
      displayName: source.displayName,
      channelId: link.spacesId,
      credentials,
      workspaceId: link.workspaceId,
    });
    return created.id;
  }
}
