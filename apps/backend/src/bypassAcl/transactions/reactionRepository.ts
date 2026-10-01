import { transaction } from '../base';
import { ReactionRepository, ReactionData } from '@/database/repositories/reactionRepository';


export function addReactionTx(self: ReactionRepository, data: ReactionData, workspaceId: string) {
  return transaction(['Reaction', 'ReactionCount'], 'addReaction: reaction insert and count upsert must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    // Insert the reaction (will fail if already exists due to unique constraint)
    await tx.reaction.create({
      data: {
        messageId: data.messageId,
        workspaceId,
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
        workspaceId,
        emojiName: data.emojiName,
        count: 1,
      },
    });
  });
}
export function removeReactionTx(self: ReactionRepository, data: ReactionData) {
  return transaction(['Reaction', 'ReactionCount'], 'removeReaction: reaction delete and count decrement/delete must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
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
