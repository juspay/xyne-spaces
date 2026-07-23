import { DatabaseClient } from '../client';
import { CustomEmoji, User } from '@prisma/client';

export interface CreateCustomEmojiInput {
  name: string;
  url: string;
  createdBy: string;
}

/**
 * CustomEmoji type with included relations
 */
export type CustomEmojiWithRelations = CustomEmoji & {
  creator: Pick<User, 'id' | 'name' | 'email' | 'picture'> | null;
};

export class CustomEmojiRepository {
  private db = DatabaseClient.getInstance();

  async create(data: CreateCustomEmojiInput): Promise<CustomEmojiWithRelations> {
    // Fetch creator (also source of the denormalized workspaceId) before insert.
    const creator = await this.db.user.findUniqueOrThrow({
      where: { id: data.createdBy },
      select: { id: true, name: true, email: true, picture: true, workspaceId: true },
    });

    const emoji = await this.db.customEmoji.create({
      data: {
        name: data.name,
        url: data.url,
        workspaceId: creator.workspaceId,
        createdBy: data.createdBy,
      },
    });

    const { workspaceId: _workspaceId, ...creatorPublic } = creator;
    return { ...emoji, creator: creatorPublic };
  }

  async findAll(): Promise<CustomEmojiWithRelations[]> {
    const emojis = await this.db.customEmoji.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Manually fetch creator data for all emojis
    const creatorIds = emojis.map(e => e.createdBy);

    const creators =
      creatorIds.length > 0
        ? await this.db.user.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, name: true, email: true, picture: true },
          })
        : [];

    const creatorMap = new Map(creators.map(c => [c.id, c]));

    return emojis.map(emoji => ({
      ...emoji,
      creator: creatorMap.get(emoji.createdBy) || null,
    }));
  }

  async findById(id: string): Promise<CustomEmojiWithRelations | null> {
    const emoji = await this.db.customEmoji.findUnique({
      where: { id },
    });

    if (!emoji) return null;

    // Manually fetch creator data
    const creator = await this.db.user.findUnique({
      where: { id: emoji.createdBy },
      select: { id: true, name: true, email: true, picture: true },
    });

    return { ...emoji, creator };
  }

  async findByName(name: string): Promise<CustomEmoji | null> {
    return await this.db.customEmoji.findUnique({
      where: { name },
    });
  }

  async findManyByNames(
    names: string[],
    select: { id: true; name: true } = { id: true, name: true }
  ): Promise<Array<{ id: string; name: string }>> {
    if (!names.length) return [];
    return await this.db.customEmoji.findMany({
      where: { name: { in: names } },
      select,
    });
  }

  async delete(id: string): Promise<CustomEmoji> {
    return await this.db.customEmoji.delete({
      where: { id },
    });
  }
}