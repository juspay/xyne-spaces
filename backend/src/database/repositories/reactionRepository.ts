import { BaseRepository } from './base';
import { Reaction } from '@prisma/client';
import { QueryOptions } from '@/types/database';
import { UserRepository } from './users';
import {logger} from '@/utils/logger';

export interface ReactionData {
  messageId: string;
  userId: string;
  emojiName: string;
}

export interface CreateReactionInput {
  messageId: string;
  userId: string;
  emojiName: string;
}

export interface UpdateReactionInput {
  emojiName?: string;
}

export interface MessageReactions {
  emojiName: string;
  count: number;
  userHasReacted: boolean;
  users: Array<{
    userId: string;
    name: string;
    email?: string;
  }>;
}

export class ReactionRepository extends BaseRepository<Reaction, CreateReactionInput, UpdateReactionInput> {
  private userRepository: UserRepository;

  constructor() {
    super('reaction');
    this.userRepository = new UserRepository();
  }

  // Helper method to get user info with caching
  private userCache = new Map<string, { userId: string; name: string; email?: string }>();

  private async getUserInfo(userId: string) {
    // Check cache first for performance
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!;
    }

    try {
      const user = await this.userRepository.findById(userId);
      if (user) {
        const userInfo = {
          userId: user.id,
          name: user.name,
          email: user.email
        };
        this.userCache.set(userId, userInfo);
        return userInfo;
      }
    } catch (error) {
      logger.warn(`getUserInfo - Failed to lookup user ${userId}:`, error);
    }

    // Enhanced fallback - try to get a more meaningful name
    let fallbackName = 'User';
    if (userId === 'dummy') {
      fallbackName = 'Anonymous User';
    } else if (userId.length > 8) {
      // If it looks like a real ID, use a shortened version
      fallbackName = `User ${userId.slice(-4)}`;
    }

    const fallbackInfo = {
      userId: userId,
      name: fallbackName,
      email: undefined
    };

    // Cache the fallback to avoid repeated lookups
    this.userCache.set(userId, fallbackInfo);
    return fallbackInfo;
  }

  async create(data: CreateReactionInput): Promise<Reaction> {
    await this.validateString(data.messageId, 'messageId');
    await this.validateString(data.userId, 'userId');
    await this.validateString(data.emojiName, 'emojiName');

    return await this.db.reaction.create({
      data: {
        messageId: data.messageId,
        userId: data.userId,
        emojiName: data.emojiName,
      }
    });
  }

  async findById(id: string): Promise<Reaction | null> {
    return await this.db.reaction.findUnique({
      where: { reactionId: id }
    });
  }

  async findMany(_options?: QueryOptions): Promise<Reaction[]> {
    return await this.db.reaction.findMany();
  }

  async update(id: string, data: UpdateReactionInput): Promise<Reaction> {
    return await this.db.reaction.update({
      where: { reactionId: id },
      data
    });
  }

  async delete(id: string): Promise<Reaction> {
    return await this.db.reaction.delete({
      where: { reactionId: id }
    });
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(data: ReactionData): Promise<void> {
    await this.db.$transaction(async (tx) => {
      // Insert the reaction (will fail if already exists due to unique constraint)
      await tx.reaction.create({
        data: {
          messageId: data.messageId,
          userId: data.userId,
          emojiName: data.emojiName,
        },
      });

      // Update or create the reaction count
      await tx.reactionCount.upsert({
        where: {
          messageId_emojiName: {
            messageId: data.messageId,
            emojiName: data.emojiName,
          },
        },
        update: {
          count: {
            increment: 1,
          },
        },
        create: {
          messageId: data.messageId,
          emojiName: data.emojiName,
          count: 1,
        },
      });
    });
  }

  /**
   * Remove a reaction from a message
   */
  async removeReaction(data: ReactionData): Promise<void> {
    await this.db.$transaction(async (tx) => {
      // Delete the reaction
      const deletedReaction = await tx.reaction.deleteMany({
        where: {
          messageId: data.messageId,
          userId: data.userId,
          emojiName: data.emojiName,
        },
      });

      // Only update count if a reaction was actually deleted
      if (deletedReaction.count > 0) {
        // Get current count
        const reactionCount = await tx.reactionCount.findUnique({
          where: {
            messageId_emojiName: {
              messageId: data.messageId,
              emojiName: data.emojiName,
            },
          },
        });

        if (reactionCount) {
          if (reactionCount.count <= 1) {
            // Remove the count record if this was the last reaction
            await tx.reactionCount.delete({
              where: {
                messageId_emojiName: {
                  messageId: data.messageId,
                  emojiName: data.emojiName,
                },
              },
            });
          } else {
            // Decrement the count
            await tx.reactionCount.update({
              where: {
                messageId_emojiName: {
                  messageId: data.messageId,
                  emojiName: data.emojiName,
                },
              },
              data: {
                count: {
                  decrement: 1,
                },
              },
            });
          }
        }
      }
    });
  }

  /**
   * Get all reactions for a message (optimized)
   */
  async getMessageReactions(messageId: string, currentUserId?: string): Promise<MessageReactions[]> {
    // Get both reaction counts and reactions in parallel for better performance
    const [reactionCounts, reactions] = await Promise.all([
      this.db.reactionCount.findMany({
        where: { messageId },
      }),
      this.db.reaction.findMany({
        where: { messageId },
      })
    ]);

    if (reactionCounts.length === 0) {
      return [];
    }

    // Group reactions by emoji
    const reactionsByEmoji = reactions.reduce((acc, reaction) => {
      if (!acc[reaction.emojiName]) {
        acc[reaction.emojiName] = [];
      }
      acc[reaction.emojiName].push({
        userId: reaction.userId,
      });
      return acc;
    }, {} as Record<string, Array<{ userId: string }>>);

    // Get unique user IDs and resolve them in batch
    const uniqueUserIds = [...new Set(reactions.map(r => r.userId))];
    const userInfoPromises = uniqueUserIds.map(userId => this.getUserInfo(userId));
    const userInfos = await Promise.all(userInfoPromises);

    // Create a user lookup map for O(1) access
    const userLookup = new Map(
      uniqueUserIds.map((userId, index) => [userId, userInfos[index]])
    );

    // Build result efficiently
    const result: MessageReactions[] = [];

    for (const count of reactionCounts) {
      const reactionUsers = reactionsByEmoji[count.emojiName] || [];

      // Use the lookup map instead of resolving users again
      const usersWithInfo = reactionUsers.map(user => userLookup.get(user.userId)!);

      const userHasReacted = currentUserId ?
        reactionUsers.some(r => r.userId === currentUserId) :
        false;

      result.push({
        emojiName: count.emojiName,
        count: count.count,
        userHasReacted,
        users: usersWithInfo,
      });
    }

    return result;
  }

  /**
   * Get reactions for multiple messages (optimized bulk loading)
   */
  async getMessagesReactions(messageIds: string[], currentUserId?: string): Promise<Record<string, MessageReactions[]>> {
    if (messageIds.length === 0) {
      return {};
    }

    // Get both reaction counts and reactions in parallel
    const [reactionCounts, reactions] = await Promise.all([
      this.db.reactionCount.findMany({
        where: { messageId: { in: messageIds } },
      }),
      this.db.reaction.findMany({
        where: { messageId: { in: messageIds } },
      })
    ]);

    // Early return if no reactions
    if (reactionCounts.length === 0) {
      return messageIds.reduce((acc, messageId) => {
        acc[messageId] = [];
        return acc;
      }, {} as Record<string, MessageReactions[]>);
    }

    // Get unique user IDs and resolve them once
    const uniqueUserIds = [...new Set(reactions.map(r => r.userId))];
    const userInfos = await Promise.all(uniqueUserIds.map(userId => this.getUserInfo(userId)));
    const userLookup = new Map(uniqueUserIds.map((userId, index) => [userId, userInfos[index]]));

    // Group reactions by message and emoji efficiently
    const reactionsByMessage = reactions.reduce((acc, reaction) => {
      if (!acc[reaction.messageId]) {
        acc[reaction.messageId] = {};
      }
      if (!acc[reaction.messageId][reaction.emojiName]) {
        acc[reaction.messageId][reaction.emojiName] = [];
      }
      acc[reaction.messageId][reaction.emojiName].push({
        userId: reaction.userId,
      });
      return acc;
    }, {} as Record<string, Record<string, Array<{ userId: string }>>>);

    // Build result efficiently
    const result: Record<string, MessageReactions[]> = {};
    messageIds.forEach(messageId => {
      result[messageId] = [];
    });

    for (const count of reactionCounts) {
      const messageReactions = reactionsByMessage[count.messageId]?.[count.emojiName] || [];

      // Use lookup map for O(1) user resolution
      const usersWithInfo = messageReactions.map(user => userLookup.get(user.userId)!);

      result[count.messageId].push({
        emojiName: count.emojiName,
        count: count.count,
        userHasReacted: currentUserId ?
          messageReactions.some(r => r.userId === currentUserId) :
          false,
        users: usersWithInfo,
      });
    }

    return result;
  }

  /**
   * Toggle a reaction - add if not exists, remove if exists
   */
  async toggleReaction(data: ReactionData): Promise<{ added: boolean }> {
    // Check if reaction already exists
    const existingReaction = await this.db.reaction.findFirst({
      where: {
        messageId: data.messageId,
        userId: data.userId,
        emojiName: data.emojiName,
      },
    });

    if (existingReaction) {
      // Remove the reaction
      await this.removeReaction(data);
      return { added: false };
    } else {
      // Add the reaction
      await this.addReaction(data);
      return { added: true };
    }
  }
}