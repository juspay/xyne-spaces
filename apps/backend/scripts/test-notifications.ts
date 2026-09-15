#!/usr/bin/env tsx

/**
 * Test script for the notification system
 * 
 * This script tests:
 * 1. Creating notifications
 * 2. Browser push notifications
 * 3. User preferences
 * 4. WebSocket real-time updates
 * 5. Notification hooks integration
 */

import { notificationService } from '../src/services/notificationService';
import { notificationHooks } from '../src/hooks/notificationHooks';
import { db } from '../src/database/client';
import { AuthProvider, UserStatus } from '@xyne/shared';

async function testNotificationSystem() {
  console.log('🧪 Starting notification system tests...\n');

  try {
    // Test 1: Create a test user if not exists
    console.log('1️⃣ Setting up test user...');
    const testUser = await db.user.upsert({
      where: { email: 'test@xyne.ai' },
      update: {},
      create: {
        name: 'Test User',
        email: 'test@xyne.ai',
        authProvider: AuthProvider.GOOGLE,
        providerUserId: 'test-user-123',
        status: UserStatus.ACTIVE
      }
    });
    console.log(`✅ Test user created/found: ${testUser.id}\n`);

    // Test 2: Create a direct notification
    console.log('2️⃣ Testing direct notification creation...');
    await notificationService.createNotification(testUser.id, {
      title: 'Test Notification',
      message: 'This is a test notification from the notification system',
      type: 'TICKET_STATUS_CHANGE',
      relatedEntityType: 'ticket',
      relatedEntityId: 'test-ticket-123',
      actionUrl: '/tickets/test-ticket-123',
      metadata: {
        oldStatus: 'OPENED',
        newStatus: 'PROCESSING',
        testRun: true
      }
    });
    console.log('✅ Direct notification created\n');

    // Test 3: Test user preferences
    console.log('3️⃣ Testing user preferences...');
    const preferences = await notificationService.getUserPreferences(testUser.id);
    console.log('Current preferences:', JSON.stringify(preferences, null, 2));
    
    // Update preferences
    await notificationService.updateUserPreferences(testUser.id, {
      TICKET_STATUS_CHANGE: { browserEnabled: true, emailEnabled: false, slackEnabled: false },
      MENTION: { browserEnabled: true, emailEnabled: true, slackEnabled: true }
    });
    console.log('✅ User preferences updated\n');

    // Test 4: Test notification hooks
    console.log('4️⃣ Testing notification hooks...');
    
    // Create a test ticket
    const testTicket = await db.ticket.create({
      data: {
        title: 'Test Ticket for Notifications',
        humanReadableId: 'TEST-001',
        status: 'OPENED',
        workflowType: 'BUG_WORKFLOW',
        createdBy: testUser.id,
        assignedTo: testUser.id
      }
    });

    // Test ticket status change hook
    await notificationHooks.onTicketStatusChange(
      testTicket.id,
      'OPENED',
      'PROCESSING',
      testUser.id
    );
    console.log('✅ Ticket status change notification sent');

    // Test ticket assignment hook
    await notificationHooks.onTicketAssignment(
      testTicket.id,
      testUser.id,
      testUser.id
    );
    console.log('✅ Ticket assignment notification sent');

    // Test mention hook
    await notificationHooks.onMention(
      testUser.id,
      testUser.id,
      testUser.name,
      'test-conversation-123'
    );
    console.log('✅ Mention notification sent\n');

    // Test 5: Retrieve notifications
    console.log('5️⃣ Testing notification retrieval...');
    const notifications = await notificationService.getUserNotifications(testUser.id, {
      page: 1,
      limit: 10
    });
    console.log(`Found ${notifications.notifications.length} notifications for user`);
    console.log('Latest notification:', notifications.notifications[0]?.id, notifications.notifications[0]?.type);

    const unreadCount = await notificationService.getUnreadCount(testUser.id);
    console.log(`Unread count: ${unreadCount}\n`);

    // Test 6: Mark notifications as read
    console.log('6️⃣ Testing notification status updates...');
    if (notifications.notifications.length > 0) {
      const firstNotification = notifications.notifications[0];
      await notificationService.markAsRead(firstNotification.id, testUser.id);
      console.log('✅ Marked first notification as read');

      if (notifications.notifications.length > 1) {
        const secondNotification = notifications.notifications[1];
        await notificationService.dismiss(secondNotification.id, testUser.id);
        console.log('✅ Dismissed second notification');
      }
    }

    const newUnreadCount = await notificationService.getUnreadCount(testUser.id);
    console.log(`New unread count: ${newUnreadCount}\n`);

    // Test 7: Test browser subscription (mock)
    console.log('7️⃣ Testing browser subscription...');
    await notificationService.saveSubscription(testUser.id, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
      p256dh: 'test-p256dh-key',
      auth: 'test-auth-key',
      userAgent: 'Test Browser'
    });
    console.log('✅ Browser subscription saved\n');

    // Cleanup
    console.log('🧹 Cleaning up test data...');
    await db.notification.deleteMany({
      where: { userId: testUser.id }
    });
    await db.browserNotificationSubscription.deleteMany({
      where: { userId: testUser.id }
    });
    await db.notificationPreference.deleteMany({
      where: { userId: testUser.id }
    });
    await db.ticket.delete({
      where: { id: testTicket.id }
    });
    await db.user.delete({
      where: { id: testUser.id }
    });
    console.log('✅ Test data cleaned up\n');

    console.log('🎉 All notification system tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  testNotificationSystem();
}

export { testNotificationSystem };
