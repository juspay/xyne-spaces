type ActivityReadClient = {
  $executeRaw(
    query: TemplateStringsArray,
    ...values: Array<string>
  ): Promise<number>;
};

/**
 * Read-state changes must not change Activity.updatedAt because the activity feed
 * uses that field as the event timestamp. Prisma's @updatedAt behavior makes a
 * normal update/updateMany unsuitable here.
 */
export async function markChannelActivitiesRead(
  client: ActivityReadClient,
  userId: string,
  channelId: string,
): Promise<number> {
  return client.$executeRaw`
    UPDATE "activities"
    SET "isRead" = true
    WHERE "userId" = ${userId}
      AND "channelId" = ${channelId}
      AND "isRead" = false
  `;
}

/** See markChannelActivitiesRead. */
export async function markThreadActivitiesRead(
  client: ActivityReadClient,
  userId: string,
  conversationId: string,
): Promise<number> {
  return client.$executeRaw`
    UPDATE "activities"
    SET "isRead" = true
    WHERE "userId" = ${userId}
      AND "conversationId" = ${conversationId}
      AND "isRead" = false
  `;
}
