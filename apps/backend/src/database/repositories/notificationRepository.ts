import { BaseRepository } from './base';
import { Notification, NotificationPreference, BrowserNotificationSubscription } from '@prisma/client';
import { NotificationType, NotificationStatus, NotificationDeliveryMethod } from '@xyne/shared';
import { currentWorkspaceId } from '@/database/tenant/context';

// Define create/update input types
type NotificationCreateInput = {
  workspaceId: string;
  userId: string;
  type: NotificationType;
  status?: NotificationStatus;
  deliveryMethods?: NotificationDeliveryMethod[];
  metadata?: any;
  relatedEntityType?: string;
  relatedEntityId?: string;
  actionUrl?: string;
  expiresAt?: Date;
};

type NotificationUpdateInput = Partial<NotificationCreateInput>;

export class NotificationRepository extends BaseRepository<Notification, NotificationCreateInput, NotificationUpdateInput> {
  constructor() {
    super('notification');
  }

  async create(data: NotificationCreateInput): Promise<Notification> {
    return this.db.notification.create({ data });
  }

  async findById(id: string): Promise<Notification | null> {
    return this.db.notification.findUnique({ where: { id } });
  }

  async findMany(options?: any): Promise<Notification[]> {
    return this.db.notification.findMany(options);
  }

  async update(id: string, data: NotificationUpdateInput): Promise<Notification> {
    return this.db.notification.update({ where: { id }, data: data as any });
  }

  async delete(id: string): Promise<Notification> {
    return this.db.notification.delete({ where: { id } });
  }

  async findByUserId(userId: string, options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<Notification[]> {
    const where: any = { userId };
    
    if (options?.status) {
      where.status = options.status;
    }

    return this.db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit,
      skip: options?.offset
    });
  }

  async countByUserId(userId: string, status?: string): Promise<number> {
    const where: any = { userId };

    if (status) {
      where.status = status;
    }

    return this.db.notification.count({ where });
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await this.db.notification.updateMany({
      where: {
        id: notificationId,
        userId
      },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date()
      }
    });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.db.notification.updateMany({
      where: {
        userId,
        status: NotificationStatus.UNREAD
      },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date()
      }
    });
  }

  async dismiss(notificationId: string, userId: string): Promise<void> {
    await this.db.notification.updateMany({
      where: {
        id: notificationId,
        userId
      },
      data: {
        status: NotificationStatus.DISMISSED,
        dismissedAt: new Date()
      }
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db.notification.deleteMany({
      where: {
        expiresAt: {
          lt: new Date()
        }
      }
    });

    return result.count;
  }
  
  async updateStatus(
    id: string,
    status: NotificationStatus
  ): Promise<Notification> {
    return this.db.notification.update({
      where: {
        id
      },
      data: {
        status
      }
    });
  }
}

// Define types for NotificationPreference
type NotificationPreferenceCreateInput = {
  workspaceId: string;
  userId: string;
  notificationType: string;
  browserEnabled?: boolean;
  emailEnabled?: boolean;
  slackEnabled?: boolean;
};

type NotificationPreferenceUpdateInput = Partial<NotificationPreferenceCreateInput>;

export class NotificationPreferenceRepository extends BaseRepository<NotificationPreference, NotificationPreferenceCreateInput, NotificationPreferenceUpdateInput> {
  constructor() {
    super('notificationPreference');
  }

  async create(data: NotificationPreferenceCreateInput): Promise<NotificationPreference> {
    // `as any` bridges the pre-existing notificationType string<->enum mismatch only.
    return this.db.notificationPreference.create({ data: data as any });
  }

  async findById(id: string): Promise<NotificationPreference | null> {
    return this.db.notificationPreference.findUnique({ where: { id } });
  }

  async findMany(options?: any): Promise<NotificationPreference[]> {
    return this.db.notificationPreference.findMany(options);
  }

  async update(id: string, data: NotificationPreferenceUpdateInput): Promise<NotificationPreference> {
    return this.db.notificationPreference.update({ where: { id }, data: data as any });
  }

  async delete(id: string): Promise<NotificationPreference> {
    return this.db.notificationPreference.delete({ where: { id } });
  }

  async findByUserId(userId: string): Promise<NotificationPreference[]> {
    return this.db.notificationPreference.findMany({
      where: { userId }
    });
  }

  async upsertPreference(
    userId: string,
    notificationType: string,
    preferences: {
      browserEnabled: boolean;
      emailEnabled: boolean;
      slackEnabled: boolean;
    }
  ): Promise<NotificationPreference> {
    const workspaceId = currentWorkspaceId();
    if (!workspaceId) {
      throw new Error('workspaceId required: no tenant context');
    }
    return this.db.notificationPreference.upsert({
      where: {
        userId_notificationType: {
          userId,
          notificationType: notificationType as any
        }
      },
      update: preferences,
      create: {
        userId,
        workspaceId,
        notificationType: notificationType as any,
        ...preferences
      }
    });
  }
}

// Define types for BrowserNotificationSubscription
type BrowserNotificationSubscriptionCreateInput = {
  workspaceId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  isActive?: boolean;
  lastUsedAt?: Date;
};

type BrowserNotificationSubscriptionUpdateInput = Partial<BrowserNotificationSubscriptionCreateInput>;

export class BrowserNotificationSubscriptionRepository extends BaseRepository<BrowserNotificationSubscription, BrowserNotificationSubscriptionCreateInput, BrowserNotificationSubscriptionUpdateInput> {
  constructor() {
    super('browserNotificationSubscription');
  }

  async create(data: BrowserNotificationSubscriptionCreateInput): Promise<BrowserNotificationSubscription> {
    return this.db.browserNotificationSubscription.create({ data });
  }

  async findById(id: string): Promise<BrowserNotificationSubscription | null> {
    return this.db.browserNotificationSubscription.findUnique({ where: { id } });
  }

  async findMany(options?: any): Promise<BrowserNotificationSubscription[]> {
    return this.db.browserNotificationSubscription.findMany(options);
  }

  async update(id: string, data: BrowserNotificationSubscriptionUpdateInput): Promise<BrowserNotificationSubscription> {
    return this.db.browserNotificationSubscription.update({ where: { id }, data: data as any });
  }

  async delete(id: string): Promise<BrowserNotificationSubscription> {
    return this.db.browserNotificationSubscription.delete({ where: { id } });
  }

  async findByUserId(userId: string, activeOnly = true): Promise<BrowserNotificationSubscription[]> {
    const where: any = { userId };
    
    if (activeOnly) {
      where.isActive = true;
    }

    return this.db.browserNotificationSubscription.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
  }

  async findByEndpoint(endpoint: string): Promise<BrowserNotificationSubscription | null> {
    return this.db.browserNotificationSubscription.findUnique({
      where: { endpoint }
    });
  }

  async upsertSubscription(data: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }): Promise<BrowserNotificationSubscription> {
    // The upsert keys on the globally unique endpoint; reject when the endpoint already
    // maps to a different user so ownership cannot be reassigned.
    const existing = await this.db.browserNotificationSubscription.findUnique({
      where: { endpoint: data.endpoint },
      select: { userId: true },
    });
    if (existing && existing.userId !== data.userId) {
      throw new Error('Push subscription endpoint already belongs to another user');
    }
    const workspaceId = currentWorkspaceId();
    if (!workspaceId) {
      throw new Error('workspaceId required: no tenant context');
    }
    return this.db.browserNotificationSubscription.upsert({
      where: { endpoint: data.endpoint },
      update: {
        userId: data.userId,
        p256dh: data.p256dh,
        auth: data.auth,
        userAgent: data.userAgent,
        isActive: true,
        lastUsedAt: new Date()
      },
      create: {
        ...data,
        workspaceId,
        isActive: true,
        lastUsedAt: new Date()
      }
    });
  }

  async deactivateByEndpoint(endpoint: string): Promise<void> {
    await this.db.browserNotificationSubscription.updateMany({
      where: { endpoint },
      data: { isActive: false }
    });
  }

  async deactivateByUserId(userId: string): Promise<void> {
    await this.db.browserNotificationSubscription.updateMany({
      where: { userId },
      data: { isActive: false }
    });
  }

  async updateLastUsed(id: string): Promise<void> {
    await this.db.browserNotificationSubscription.update({
      where: { id },
      data: { lastUsedAt: new Date() }
    });
  }

  async cleanupInactiveSubscriptions(daysOld = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.db.browserNotificationSubscription.deleteMany({
      where: {
        OR: [
          {
            isActive: false,
            updatedAt: { lt: cutoffDate }
          },
          {
            lastUsedAt: { lt: cutoffDate }
          }
        ]
      }
    });

    return result.count;
  }
}
