import { ExternalSourceRepository, db, encrypt } from '../../../re-exports';
import type { MessageSource, MirrorLink } from '../types';

/** Mirror's message-map rows in ExternalSource, shared with self-serve migration. */
export class MessageSourceRepository {
  private readonly sources = new ExternalSourceRepository();

  /**
   * The link's message-map rows: `sourceId` (created if missing) takes new rows; `sourceIds` adds any
   * older migration's history for this channel, read so nothing is copied twice.
   */
  async findMessageScopes(
    source: MessageSource,
    legacyNames: string[],
    link: MirrorLink
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

  /** The link's message-map source. It holds no secrets: the provider downloads files with its own token. */
  async ensureMessageSource(source: MessageSource, link: MirrorLink): Promise<string> {
    const existing = await this.sources.findByName(source.name);
    if (existing) {
      if (!existing.isActive) await this.sources.update(existing.id, { isActive: true });
      return existing.id;
    }
    const created = await this.sources.create({
      name: source.name,
      sourceType: source.sourceType,
      displayName: source.displayName,
      channelId: link.spacesId,
      credentials: encrypt('{}'),
      workspaceId: link.workspaceId,
    });
    return created.id;
  }
}
