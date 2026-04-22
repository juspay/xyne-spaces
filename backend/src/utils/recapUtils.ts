import { db } from '../database/client';
import { logger } from './logger';

/**
 * Calculate unread recap count for a user
 *
 * @param userId - The user ID to calculate unread count for
 * @returns The number of unread recaps
 */
export async function calculateUnreadCount(userId: string): Promise<number> {
  try {
    // Get user's subscriptions from channelUserStatus where isRecapSubscribed is true
    const subscriptions = await db.channelUserStatus.findMany({
      where: { 
        userId,
        isRecapSubscribed: true,
      },
      select: {
        channelId: true,
        lastSeenRecapDate: true,
      },
    });

    if (subscriptions.length === 0) {
      return 0;
    }

    const channelIds = subscriptions.map((sub: { channelId: string }) => sub.channelId);

    // Get yesterday's date in IST using proper date arithmetic
    const now = new Date();

    // Use Intl.DateTimeFormat to get the date parts in IST
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    // Get current date in IST
    const parts = formatter.formatToParts(now);
    const year = parts.find((p) => p.type === 'year')?.value || now.getFullYear().toString();
    const month =
      parts.find((p) => p.type === 'month')?.value ||
      (now.getMonth() + 1).toString().padStart(2, '0');
    const day =
      parts.find((p) => p.type === 'day')?.value || now.getDate().toString().padStart(2, '0');

    // Create a date object for current IST date and subtract 1 day (handles month boundaries correctly)
    const istDate = new Date(`${year}-${month}-${day}T00:00:00+05:30`);
    istDate.setDate(istDate.getDate() - 1);

    // Format yesterday's date in IST
    const yesterdayDateStr = istDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Create the date at UTC to match storage format
    const yesterday = new Date(`${yesterdayDateStr}T00:00:00Z`);

    // Check if there are any recaps for yesterday - use exact date match since recapDate is normalized to midnight IST
    const recaps = await db.channelRecap.findMany({
      where: {
        channelId: { in: channelIds },
        recapDate: yesterday,
      },
    });

    if (recaps.length === 0) {
      return 0;
    }

    // Count unread recaps
    let unreadCount = 0;
    for (const recap of recaps) {
      const subscription = subscriptions.find((sub: any) => sub.channelId === recap.channelId);
      if (subscription) {
        if (!subscription.lastSeenRecapDate) {
          unreadCount++;
        } else {
          const lastSeen = new Date(subscription.lastSeenRecapDate);
          // Convert both dates to UTC timestamp for accurate comparison
          // Recap is unread if lastSeen date is strictly before the recap date
          const lastSeenTimestamp = lastSeen.getTime();
          const yesterdayTimestamp = yesterday.getTime();

          if (lastSeenTimestamp < yesterdayTimestamp) {
            unreadCount++;
          }
        }
      }
    }

    return unreadCount;
  } catch (error) {
    logger.error('Error calculating unread recap count:', error);
    return 0;
  }
}
