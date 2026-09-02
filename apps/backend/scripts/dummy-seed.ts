#!/usr/bin/env npx tsx
/// <reference types="node" />

/**
 * Dummy Data Seeding Script
 * 
 * This script creates realistic dummy data for development/testing purposes.
 * It maintains all foreign key relationships and creates interconnected data.
 * 
 * Usage: npx tsx backend/scripts/dummy-seed.ts
 */

import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  AccessType,
  AuthProvider,
  UserStatus,
  SessionStatus,
  TicketStatus,
  TicketStatusV2,
  TicketPriority,
  TicketReferenceRelation,
  ActivityType,
  OrgRole,
  ChannelType,
  ChannelScopeType,
  ChannelVisibility,
  ChannelRole,
  MessageType,
  CallType,
  CallStatus,
  InvitationResponse,
  ConversationParticipation,
  NotificationType,
  NotificationStatus,
  NotificationDeliveryMethod,
  PRStatus,
  ExternalEntityType,
  MessageDirection,
  ActivityClassification,
  ActivityClassificationJobType,
  AttachmentEntityType,
  CanvasVisibility,
  CanvasRole,
  BookmarkEntityType,
  VespaInsertionStatus,
  VespaOperationType,
  FormFieldType,
  FormContextType,
  FormEntityType,
  DocType,
  ProjectType, UserPresenceStatus } from '@xyne/shared';
import { createId } from '@paralleldrive/cuid2';

const prisma = new PrismaClient();

// Helper function to generate CUID
const generateId = () => createId();

// Helper function to generate dates
const now = () => new Date();
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

// Helper to create xyneId pattern
const generateXyneId = (num: number) => `XYNE-${String(num).padStart(5, '0')}`;

async function main() {
  console.log('🌱 Starting dummy data seeding...\n');

  try {
    // Use a transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      
      console.log('  Creating sequences...');
      await tx.$executeRaw`
        CREATE SEQUENCE IF NOT EXISTS ticket_xyne_id_seq START 1
      `;
      console.log('    ✅ Sequence ticket_xyne_id_seq created');

      // ============================================
      // PHASE 1: Foundation Data
      // ============================================
      console.log('📦 Phase 1: Foundation Data...');

      // Create Organizations
      console.log('  Creating Organizations...');
      const org1 = await tx.organization.create({
        data: {
          orgId: generateId(),
          name: 'Xyne Technologies',
          description: 'Xyne Technologies Inc.',
          createdBy: 'system',
          metadata: { industry: 'Technology', website: 'https://xyne.ai' }
        }
      });

      const org2 = await tx.organization.create({
        data: {
          orgId: generateId(),
          name: 'Juspay Innovations',
          description: 'Payment solutions company',
          createdBy: 'system',
          metadata: { industry: 'FinTech', website: 'https://juspay.in' }
        }
      });
      console.log(`    ✅ Created 2 organizations`);

      // Create Users
      console.log('  Creating Users...');
      const user1 = await tx.user.create({
        data: {
          name: 'John Developer',
          email: 'john.developer@xyne.ai',
          picture: 'https://ui-avatars.com/api/?name=John+Developer&background=6276BE&color=fff',
          authProvider: AuthProvider.GOOGLE,
          providerUserId: 'google-user-001',
          status: UserStatus.ACTIVE,
          metadata: { department: 'Engineering', level: 'Senior' }
        }
      });

      const user2 = await tx.user.create({
        data: {
          name: 'Sarah Designer',
          email: 'sarah.designer@xyne.ai',
          picture: 'https://ui-avatars.com/api/?name=Sarah+Designer&background=E91E63&color=fff',
          authProvider: AuthProvider.GOOGLE,
          providerUserId: 'google-user-002',
          status: UserStatus.ACTIVE,
          metadata: { department: 'Design', level: 'Mid' }
        }
      });

      const user3 = await tx.user.create({
        data: {
          name: 'Mike Product',
          email: 'mike.product@xyne.ai',
          picture: 'https://ui-avatars.com/api/?name=Mike+Product&background=4CAF50&color=fff',
          authProvider: AuthProvider.GOOGLE,
          providerUserId: 'google-user-003',
          status: UserStatus.ACTIVE,
          metadata: { department: 'Product', level: 'Senior' }
        }
      });

      const user4 = await tx.user.create({
        data: {
          name: 'Lisa QA',
          email: 'lisa.qa@xyne.ai',
          picture: 'https://ui-avatars.com/api/?name=Lisa+QA&background=FF9800&color=fff',
          authProvider: AuthProvider.GOOGLE,
          providerUserId: 'google-user-004',
          status: UserStatus.ACTIVE,
          metadata: { department: 'QA', level: 'Junior' }
        }
      });
      console.log(`    ✅ Created 4 users`);

      // Create User Profiles
      console.log('  Creating User Profiles...');
      await tx.userProfile.create({
        data: {
          userId: user1.id,
          displayName: 'John D.',
          team: 'Frontend Team',
          role: 'Senior Developer',
          joinedOn: daysAgo(365),
          pronunciation: 'john'
        }
      });

      await tx.userProfile.create({
        data: {
          userId: user2.id,
          displayName: 'Sarah S.',
          team: 'UX Team',
          role: 'Product Designer',
          joinedOn: daysAgo(180),
          phoneNumber: '+1-555-0101'
        }
      });

      await tx.userProfile.create({
        data: {
          userId: user3.id,
          displayName: 'Mike P.',
          team: 'Product Team',
          role: 'Product Manager',
          joinedOn: daysAgo(720),
          manager: user1.id
        }
      });

      await tx.userProfile.create({
        data: {
          userId: user4.id,
          displayName: 'Lisa Q.',
          team: 'QA Team',
          role: 'QA Engineer',
          joinedOn: daysAgo(90)
        }
      });
      console.log(`    ✅ Created 4 user profiles`);

      // Create User Presence
      console.log('  Creating User Presence...');
      await tx.userPresence.create({
        data: {
          userId: user1.id,
          status: UserPresenceStatus.ONLINE as any,
          lastActiveAt: now(),
          lastSeenAt: now(),
          isManual: false,
          statusEmoji: '🚀',
          statusContent: 'Building awesome features!'
        }
      });

      await tx.userPresence.create({
        data: {
          userId: user2.id,
          status: UserPresenceStatus.AWAY as any,
          lastActiveAt: hoursAgo(1),
          lastSeenAt: hoursAgo(1),
          isManual: false
        }
      });

      await tx.userPresence.create({
        data: {
          userId: user3.id,
          status: UserPresenceStatus.OFFLINE as any,
          lastActiveAt: hoursAgo(4),
          lastSeenAt: hoursAgo(4),
          isManual: false
        }
      });

      await tx.userPresence.create({
        data: {
          userId: user4.id,
          status: UserPresenceStatus.ONLINE as any,
          lastActiveAt: now(),
          lastSeenAt: now(),
          isManual: false,
          statusEmoji: '🧪',
          statusContent: 'Testing in progress'
        }
      });
      console.log(`    ✅ Created 4 user presence records`);

      // Create User Groups
      console.log('  Creating User Groups...');
      const dummyAdminGroup = await tx.userGroup.create({
        data: {
          name: 'DUMMY_ADMIN',
          alias: 'dummy-admin',
          description: 'Dummy admin group for testing',
          metadata: { color: '#FF0000' }
        }
      });

      const dummyDevGroup = await tx.userGroup.create({
        data: {
          name: 'DUMMY_DEVELOPER',
          alias: 'dummy-dev',
          description: 'Dummy developer group for testing',
          metadata: { color: '#4CAF50' }
        }
      });

      const dummyViewerGroup = await tx.userGroup.create({
        data: {
          name: 'DUMMY_VIEWER',
          alias: 'dummy-viewer',
          description: 'Dummy viewer group for testing',
          metadata: { color: '#2196F3' }
        }
      });
      console.log(`    ✅ Created 3 user groups`);

      // Create Resources for ACL (check if they already exist)
      console.log('  Creating Resources...');
      const resources = [];
      const resourceNames = ['TICKETS', 'USERS', 'WORKFLOWS', 'AGENTS', 'TOOLS', 'CHAT'];
      
      for (const name of resourceNames) {
        // Check if resource already exists
        const existing = await tx.resource.findUnique({
          where: { name }
        });
        
        if (existing) {
          console.log(`    ℹ️  Resource ${name} already exists, reusing...`);
          resources.push(existing);
        } else {
          // Create new resource
          const resource = await tx.resource.create({
            data: {
              name,
              description: `Dummy ${name.toLowerCase()} resource for testing`
            }
          });
          console.log(`    ✅ Created resource: ${name}`);
          resources.push(resource);
        }
      }
      console.log(`    ✅ Ready with ${resources.length} resources`);

      // Create User Group Memberships
      console.log('  Creating User Group Mappings...');
      await tx.userGroupMapping.create({
        data: { userId: user1.id, userGroupId: dummyAdminGroup.id }
      });
      await tx.userGroupMapping.create({
        data: { userId: user2.id, userGroupId: dummyDevGroup.id }
      });
      await tx.userGroupMapping.create({
        data: { userId: user3.id, userGroupId: dummyDevGroup.id }
      });
      await tx.userGroupMapping.create({
        data: { userId: user4.id, userGroupId: dummyViewerGroup.id }
      });
      console.log(`    ✅ Created 4 user group mappings`);

      // Create Resource Access (Permissions)
      console.log('  Creating Resource Access...');
      for (const resource of resources) {
        await tx.resourceAccess.create({
          data: {
            groupId: dummyAdminGroup.id,
            resourceId: resource.id,
            accessType: AccessType.ADMIN
          }
        });
      }
      
      const devResources = resources.slice(0, 4);
      for (const resource of devResources) {
        await tx.resourceAccess.create({
          data: {
            groupId: dummyDevGroup.id,
            resourceId: resource.id,
            accessType: AccessType.WRITE
          }
        });
      }

      const viewerResources = resources.slice(0, 2);
      for (const resource of viewerResources) {
        await tx.resourceAccess.create({
          data: {
            groupId: dummyViewerGroup.id,
            resourceId: resource.id,
            accessType: AccessType.READ
          }
        });
      }
      console.log(`    ✅ Created resource access permissions`);

      // Create API Keys
      console.log('  Creating API Keys...');
      await tx.apiKey.create({
        data: {
          name: 'John Dev Key',
          description: 'Development API key',
          keyHash: 'sha256:' + generateId(),
          userId: user1.id,
          scopes: JSON.stringify(['read', 'write']),
          expiresAt: daysAgo(30),
          isActive: true
        }
      });

      await tx.apiKey.create({
        data: {
          name: 'Sarah Design Key',
          description: 'Design tool API key',
          keyHash: 'sha256:' + generateId(),
          userId: user2.id,
          scopes: JSON.stringify(['read']),
          isActive: true
        }
      });
      console.log(`    ✅ Created 2 API keys`);

      // Create User Sessions
      console.log('  Creating User Sessions...');
      await tx.userSession.create({
        data: {
          userId: user1.id,
          refreshToken: generateId(),
          refreshTokenExpiry: daysAgo(30),
          accessToken: generateId(),
          accessTokenExpiry: hoursAgo(1),
          status: SessionStatus.ACTIVE,
          deviceInfo: JSON.stringify({ os: 'macOS', browser: 'Chrome' }),
          ipAddress: '192.168.1.100'
        }
      });

      await tx.userSession.create({
        data: {
          userId: user2.id,
          refreshToken: generateId(),
          refreshTokenExpiry: daysAgo(30),
          accessToken: generateId(),
          accessTokenExpiry: hoursAgo(2),
          status: SessionStatus.ACTIVE,
          deviceInfo: JSON.stringify({ os: 'Windows', browser: 'Firefox' }),
          ipAddress: '192.168.1.101'
        }
      });
      console.log(`    ✅ Created 2 user sessions`);

      // ============================================
      // PHASE 2: Core Business Entities
      // ============================================
      console.log('\n📦 Phase 2: Core Business Entities...');

      // Create Projects
      console.log('  Creating Projects...');
      const project1 = await tx.project.create({
        data: {
          name: 'Xyne Spaces',
          code: 'XYNE',
          description: 'Unified collaboration platform',
          type: ProjectType.DEFAULT,
          createdBy: user1.id,
          updatedBy: user2.id
        }
      });

      const project2 = await tx.project.create({
        data: {
          name: 'Internal Tools',
          code: 'INT',
          description: 'Internal productivity tools',
          type: ProjectType.DEFAULT,
          createdBy: user3.id,
          updatedBy: user4.id
        }
      });
      console.log(`    ✅ Created 2 projects`);

      // Create Boards
      console.log('  Creating Boards...');
      const board1 = await tx.board.create({
        data: {
          name: 'Development',
          projectId: project1.id,
          createdBy: user1.id,
          updatedBy: user2.id
        }
      });

      const board2 = await tx.board.create({
        data: {
          name: 'Bug Fixes',
          projectId: project1.id,
          createdBy: user3.id,
          updatedBy: user4.id
        }
      });
      console.log(`    ✅ Created 2 boards`);

      // Create Stages
      console.log('  Creating Stages...');
      await tx.stage.createMany({
        data: [
          {
            name: 'Backlog',
            eta: 0,
            boardId: board1.id,
            sequenceNumber: 1,
            createdBy: user1.id,
            defaultTicketStatusV2: TicketStatusV2.TODO
          },
          {
            name: 'In Progress',
            eta: 24,
            boardId: board1.id,
            sequenceNumber: 2,
            createdBy: user1.id,
            defaultTicketStatusV2: TicketStatusV2.STARTED
          },
          {
            name: 'Review',
            eta: 48,
            boardId: board1.id,
            sequenceNumber: 3,
            createdBy: user1.id,
            defaultTicketStatusV2: TicketStatusV2.PAUSED
          },
          {
            name: 'Done',
            eta: 72,
            boardId: board1.id,
            sequenceNumber: 4,
            createdBy: user1.id,
            defaultTicketStatusV2: TicketStatusV2.COMPLETED
          },
          {
            name: 'New Bugs',
            eta: 0,
            boardId: board2.id,
            sequenceNumber: 1,
            createdBy: user3.id,
            defaultTicketStatusV2: TicketStatusV2.TODO
          },
          {
            name: 'Investigating',
            eta: 12,
            boardId: board2.id,
            sequenceNumber: 2,
            createdBy: user3.id,
            defaultTicketStatusV2: TicketStatusV2.STARTED
          }
        ]
      });
      console.log(`    ✅ Created 6 stages`);

      // Create Channels
      console.log('  Creating Channels...');
      const generalChannel = await tx.channel.create({
        data: {
          name: 'general',
          description: 'General discussions',
          type: ChannelType.DEFAULT,
          scopeType: ChannelScopeType.DEFAULT,
          visibility: ChannelVisibility.PUBLIC,
          createdBy: user1.id,
          projectId: project1.id,
          participantCount: 4,
          isMigrated: false
        }
      });

      const devChannel = await tx.channel.create({
        data: {
          name: 'development',
          description: 'Development team discussions',
          type: ChannelType.DEFAULT,
          scopeType: ChannelScopeType.DEFAULT,
          visibility: ChannelVisibility.PUBLIC,
          createdBy: user1.id,
          projectId: project1.id,
          participantCount: 2,
          isMigrated: false
        }
      });

      const designChannel = await tx.channel.create({
        data: {
          name: 'design',
          description: 'Design discussions and reviews',
          type: ChannelType.DEFAULT,
          scopeType: ChannelScopeType.DEFAULT,
          visibility: ChannelVisibility.PUBLIC,
          createdBy: user2.id,
          projectId: project1.id,
          participantCount: 3,
          isMigrated: false
        }
      });
      console.log(`    ✅ Created 3 channels`);

      // Create Channel Participants
      console.log('  Creating Channel Participants...');
      const channelParticipants = [
        { channelId: generalChannel.id, userId: user1.id, role: ChannelRole.ADMIN },
        { channelId: generalChannel.id, userId: user2.id, role: ChannelRole.MEMBER },
        { channelId: generalChannel.id, userId: user3.id, role: ChannelRole.MEMBER },
        { channelId: generalChannel.id, userId: user4.id, role: ChannelRole.MEMBER },
        { channelId: devChannel.id, userId: user1.id, role: ChannelRole.ADMIN },
        { channelId: devChannel.id, userId: user3.id, role: ChannelRole.MEMBER },
        { channelId: designChannel.id, userId: user2.id, role: ChannelRole.ADMIN },
        { channelId: designChannel.id, userId: user1.id, role: ChannelRole.MEMBER },
        { channelId: designChannel.id, userId: user4.id, role: ChannelRole.MEMBER },
      ];

      for (const cp of channelParticipants) {
        await tx.channelParticipant.create({ data: cp });
      }
      console.log(`    ✅ Created 9 channel participants`);

      // Create Channel User Status
      console.log('  Creating Channel User Status...');
      for (const cp of channelParticipants) {
        await tx.channelUserStatus.create({
          data: {
            channelId: cp.channelId,
            userId: cp.userId,
            unreadCount: Math.floor(Math.random() * 5),
            isStarred: cp.role === ChannelRole.ADMIN
          }
        });
      }
      console.log(`    ✅ Created 9 channel user status records`);

      // Create Conversations
      console.log('  Creating Conversations...');
      const conv1 = await tx.conversation.create({
        data: {
          channelId: generalChannel.id,
          createdBy: user1.id,
          initialMessageId: generateId(),
          workspaceId: generalChannel.workspaceId,
          lastActivityAt: hoursAgo(1),
          replyCount: 5,
          pinned: false
        }
      });

      const conv2 = await tx.conversation.create({
        data: {
          channelId: devChannel.id,
          createdBy: user3.id,
          initialMessageId: generateId(),
          workspaceId: devChannel.workspaceId,
          lastActivityAt: hoursAgo(2),
          replyCount: 3,
          pinned: true
        }
      });

      const conv3 = await tx.conversation.create({
        data: {
          channelId: designChannel.id,
          createdBy: user2.id,
          initialMessageId: generateId(),
          workspaceId: designChannel.workspaceId,
          lastActivityAt: hoursAgo(3),
          replyCount: 7,
          pinned: false
        }
      });

      const conv4 = await tx.conversation.create({
        data: {
          channelId: generalChannel.id,
          createdBy: user4.id,
          initialMessageId: generateId(),
          workspaceId: generalChannel.workspaceId,
          lastActivityAt: hoursAgo(4),
          replyCount: 2,
          parentMessageId: generateId(),
          pinned: false
        }
      });
      console.log(`    ✅ Created 4 conversations`);

      // Create Conversation Participants
      console.log('  Creating Conversation Participants...');
      await tx.conversationParticipant.createMany({
        data: [
          { conversationId: conv1.conversationId, userId: user1.id, participationType: ConversationParticipation.AUTHOR },
          { conversationId: conv1.conversationId, userId: user2.id, participationType: ConversationParticipation.MENTIONED },
          { conversationId: conv2.conversationId, userId: user3.id, participationType: ConversationParticipation.AUTHOR },
          { conversationId: conv2.conversationId, userId: user1.id, participationType: ConversationParticipation.AUTHOR },
          { conversationId: conv3.conversationId, userId: user2.id, participationType: ConversationParticipation.AUTHOR },
          { conversationId: conv3.conversationId, userId: user4.id, participationType: ConversationParticipation.AUTHOR },
          { conversationId: conv4.conversationId, userId: user4.id, participationType: ConversationParticipation.AUTHOR },
          { conversationId: conv4.conversationId, userId: user3.id, participationType: ConversationParticipation.MENTIONED }
        ]
      });
      console.log(`    ✅ Created 8 conversation participants`);

      // Create Messages
      console.log('  Creating Messages...');
      const createdMessages: any[] = [];
      const messageData = [
        {
          conversationId: conv1.conversationId,
          workspaceId: generalChannel.workspaceId,
          senderId: user1.id,
          content: 'Hey everyone! Welcome to the Xyne Spaces project!',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv1.conversationId,
          workspaceId: generalChannel.workspaceId,
          senderId: user2.id,
          content: 'Excited to work on this! Let me know if you need any design help.',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv1.conversationId,
          workspaceId: generalChannel.workspaceId,
          senderId: user1.id,
          content: 'Thanks Sarah! @mike.product, could you share the requirements?',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv1.conversationId,
          workspaceId: generalChannel.workspaceId,
          senderId: user3.id,
          content: 'Sure! I\'ll upload the requirements document shortly.',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv2.conversationId,
          workspaceId: devChannel.workspaceId,
          senderId: user3.id,
          content: 'I found a potential bug in the workflow execution engine.',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv2.conversationId,
          workspaceId: devChannel.workspaceId,
          senderId: user1.id,
          content: 'Can you share more details? I\'ll investigate.',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv2.conversationId,
          workspaceId: devChannel.workspaceId,
          senderId: user3.id,
          content: 'Check the workflow ticket I created. Steps are not executing in the correct order.',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv3.conversationId,
          workspaceId: designChannel.workspaceId,
          senderId: user2.id,
          content: 'New mockups are ready for the dashboard redesign!',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv3.conversationId,
          workspaceId: designChannel.workspaceId,
          senderId: user4.id,
          content: 'These look great! When can we start implementing?',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv3.conversationId,
          workspaceId: designChannel.workspaceId,
          senderId: user2.id,
          content: 'Next week. Let me create tickets for each component.',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv4.conversationId,
          workspaceId: generalChannel.workspaceId,
          senderId: user4.id,
          content: 'QA is done for the user auth module.',
          msgType: MessageType.USER,
          showInChannel: true
        },
        {
          conversationId: conv4.conversationId,
          workspaceId: generalChannel.workspaceId,
          senderId: user3.id,
          content: 'Great work Lisa! Any blockers?',
          msgType: MessageType.USER,
          showInChannel: true
        }
      ];

      for (const msg of messageData) {
        const created = await tx.message.create({ data: msg });
        createdMessages.push(created);
      }
      console.log(`    ✅ Created ${createdMessages.length} messages`);

      // Create Message Attachments
      console.log('  Creating Message Attachments...');
      await tx.messageAttachment.create({
        data: {
          entityType: AttachmentEntityType.CHAT,
          entityId: createdMessages[0].messageId,
          storageProvider: 'gcs',
          originalFilename: 'requirements.pdf',
          mimetype: 'application/pdf',
          size: 1024000,
          uploadedByUserId: user3.id,
          url: 'https://storage.xyne.ai/requirements.pdf',
          createdBy: user3.id,
          conversationId: conv1.conversationId
        }
      });

      await tx.messageAttachment.create({
        data: {
          entityType: AttachmentEntityType.CHAT,
          entityId: createdMessages[7].messageId,
          storageProvider: 'gcs',
          originalFilename: 'dashboard-mockup.png',
          mimetype: 'image/png',
          size: 512000,
          width: 1920,
          height: 1080,
          uploadedByUserId: user2.id,
          url: 'https://storage.xyne.ai/dashboard-mockup.png',
          thumbnailUrl: 'https://storage.xyne.ai/dashboard-mockup-thumb.png',
          createdBy: user2.id,
          conversationId: conv3.conversationId
        }
      });
      console.log(`    ✅ Created 2 message attachments`);

      // Create Reactions
      console.log('  Creating Reactions...');
      await tx.reaction.createMany({
        data: [
          { messageId: createdMessages[0].messageId, userId: user2.id, emojiName: '👍' },
          { messageId: createdMessages[0].messageId, userId: user3.id, emojiName: '👋' },
          { messageId: createdMessages[1].messageId, userId: user1.id, emojiName: '🙏' },
          { messageId: createdMessages[7].messageId, userId: user1.id, emojiName: '🎨' },
          { messageId: createdMessages[7].messageId, userId: user4.id, emojiName: '🔥' },
          { messageId: createdMessages[10].messageId, userId: user1.id, emojiName: '✨' }
        ]
      });
      console.log(`    ✅ Created 6 reactions`);

      // Create Reaction Counts
      console.log('  Creating Reaction Counts...');
      await tx.reactionCount.createMany({
        data: [
          { messageId: createdMessages[0].messageId, emojiName: '👋', count: 1 },
          { messageId: createdMessages[0].messageId, emojiName: '👍', count: 1 },
          { messageId: createdMessages[1].messageId, emojiName: '🙏', count: 1 },
          { messageId: createdMessages[7].messageId, emojiName: '🎨', count: 1 },
          { messageId: createdMessages[7].messageId, emojiName: '🔥', count: 1 },
          { messageId: createdMessages[10].messageId, emojiName: '✨', count: 1 }
        ]
      });
      console.log(`    ✅ Created 6 reaction counts`);

      // ============================================
      // PHASE 3: Tickets & Workflows
      // ============================================
      console.log('\n📦 Phase 3: Tickets & Workflows...');

      // Create Tickets
      console.log('  Creating Tickets...');
      const ticket1 = await tx.ticket.create({
        data: {
          title: 'Implement workflow execution engine',
          description: 'Build the core workflow execution engine with support for sequential and parallel steps.',
          status: TicketStatus.IN_PROGRESS,
          statusV2: TicketStatusV2.STARTED,
          createdBy: user1.id,
          updatedBy: user3.id,
          assignedTo: user1.id,
          merchantId: 'merchant-001',
          conversationId: conv2.conversationId,
          channelId: devChannel.id,
          eta: daysAgo(7),
          priority: TicketPriority.HIGH,
          metadata: { complexity: 'high', estimatedHours: 40 },
          xyneId: generateXyneId(1),
          projectId: project1.id,
          userGroupId: dummyDevGroup.id,
          boardId: board1.id,
          stageName: 'In Progress'
        }
      });

      const ticket2 = await tx.ticket.create({
        data: {
          title: 'Fix bug in user authentication',
          description: 'Users are experiencing intermittent login issues due to token refresh problems.',
          status: TicketStatus.NEW,
          statusV2: TicketStatusV2.TODO,
          createdBy: user4.id,
          updatedBy: user1.id,
          assignedTo: user1.id,
          merchantId: 'merchant-002',
          conversationId: conv4.conversationId,
          channelId: generalChannel.id,
          eta: daysAgo(3),
          priority: TicketPriority.CRITICAL,
          metadata: { severity: 'critical', affectedUsers: 50 },
          xyneId: generateXyneId(2),
          projectId: project1.id,
          userGroupId: dummyDevGroup.id,
          boardId: board2.id,
          stageName: 'New Bugs'
        }
      });

      const ticket3 = await tx.ticket.create({
        data: {
          title: 'Dashboard UI redesign',
          description: 'Redesign the dashboard UI according to new brand guidelines.',
          status: TicketStatus.RESOLVED,
          statusV2: TicketStatusV2.COMPLETED,
          createdBy: user2.id,
          updatedBy: user2.id,
          assignedTo: user2.id,
          merchantId: 'merchant-003',
          conversationId: conv3.conversationId,
          channelId: designChannel.id,
          closedAt: daysAgo(1),
          closedBy: user2.id,
          eta: daysAgo(5),
          priority: TicketPriority.MEDIUM,
          metadata: { pages: 5, components: 20 },
          xyneId: generateXyneId(3),
          projectId: project1.id,
          userGroupId: dummyDevGroup.id,
          boardId: board1.id,
          stageName: 'Done'
        }
      });
      console.log(`    ✅ Created 3 tickets`);

      // Create Ticket Activities
      console.log('  Creating Ticket Activities...');
      await tx.ticketActivity.createMany({
        data: [
          {
            ticketId: ticket1.id,
            updatedBy: user1.id,
            activityType: ActivityType.TITLE,
            value: { old: 'Build workflow engine', new: 'Implement workflow execution engine' }
          },
          {
            ticketId: ticket1.id,
            updatedBy: user3.id,
            activityType: ActivityType.ASSIGNED_TO,
            value: { assignedTo: user1.name }
          },
          {
            ticketId: ticket1.id,
            updatedBy: user3.id,
            activityType: ActivityType.STATUS,
            value: { status: 'TODO', newStatus: 'STARTED' }
          },
          {
            ticketId: ticket2.id,
            updatedBy: user4.id,
            activityType: ActivityType.PRIORITY,
            value: { priority: TicketPriority.HIGH, newPriority: 'CRITICAL' }
          },
          {
            ticketId: ticket3.id,
            updatedBy: user2.id,
            activityType: ActivityType.STATUS,
            value: { status: 'STARTED', newStatus: 'COMPLETED' }
          },
          {
            ticketId: ticket3.id,
            updatedBy: user2.id,
            activityType: ActivityType.CLOSED_AT,
            value: { closedAt: daysAgo(1), closedBy: user2.name }
          }
        ]
      });
      console.log(`    ✅ Created 6 ticket activities`);

      // Create Ticket Tags
      console.log('  Creating Ticket Tags...');
      await tx.ticketTag.createMany({
        data: [
          { name: 'backend', ticketId: ticket1.id },
          { name: 'workflow', ticketId: ticket1.id },
          { name: 'urgent', ticketId: ticket1.id },
          { name: 'bug', ticketId: ticket2.id },
          { name: 'authentication', ticketId: ticket2.id },
          { name: 'frontend', ticketId: ticket3.id },
          { name: 'design', ticketId: ticket3.id },
          { name: 'ui', ticketId: ticket3.id }
        ]
      });
      console.log(`    ✅ Created 8 ticket tags`);

      // Create Ticket Reference Mappings
      console.log('  Creating Ticket Reference Mappings...');
      await tx.ticketReferenceMapping.create({
        data: {
          sourceTicketId: ticket1.id,
          targetTicketId: ticket2.id,
          relationType: TicketReferenceRelation.LINKED,
          createdBy: user3.id
        }
      });
      console.log(`    ✅ Created 1 ticket reference mapping`);

      // Create Workflows
      console.log('  Creating Workflows...');
      const workflow1 = await tx.workflow.create({
        data: {
          ticketId: ticket1.id,
          context: JSON.stringify({ feature: 'workflow-execution-engine' }),
          status: 'RUNNING',
          workflowName: 'WorkflowExecutionEngine',
          metadata: JSON.stringify({ priority: 'high' }),
          workflowType: 'FEATURE_IMPLEMENTATION'
        }
      });

      const workflow2 = await tx.workflow.create({
        data: {
          ticketId: ticket2.id,
          context: JSON.stringify({ bug: 'auth-token-refresh' }),
          status: 'SUCCESS',
          workflowName: 'BugFix_Authentication',
          metadata: JSON.stringify({ severity: 'critical' }),
          workflowType: 'BUG_WORKFLOW'
        }
      });

      const workflow3 = await tx.workflow.create({
        data: {
          ticketId: ticket3.id,
          context: JSON.stringify({ feature: 'dashboard-redesign' }),
          status: 'SUCCESS',
          workflowName: 'UIDesign_Implementation',
          workflowType: 'FEATURE_IMPLEMENTATION'
        }
      });
      console.log(`    ✅ Created 3 workflows`);

      // Create Workflow Executions
      console.log('  Creating Workflow Executions...');
      const exec1 = await tx.workflowExecution.create({
        data: {
          workflowId: workflow1.id,
          workflowType: 'FEATURE_IMPLEMENTATION',
          context: JSON.stringify({ phase: 'implementation' }),
          status: 'RUNNING',
          tag: 'root'
        }
      });

      const exec2 = await tx.workflowExecution.create({
        data: {
          workflowId: workflow2.id,
          workflowType: 'BUG_WORKFLOW',
          context: JSON.stringify({ phase: 'fix' }),
          status: 'SUCCESS',
          output: JSON.stringify({ fixApplied: true }),
          tag: 'root'
        }
      });

      const exec3 = await tx.workflowExecution.create({
        data: {
          workflowId: workflow3.id,
          workflowType: 'FEATURE_IMPLEMENTATION',
          context: JSON.stringify({ phase: 'implementation' }),
          status: 'SUCCESS',
          output: JSON.stringify({ uiImplemented: true }),
          tag: 'root'
        }
      });
      console.log(`    ✅ Created 3 workflow executions`);

      // Create Workflow Steps
      console.log('  Creating Workflow Steps...');
      await tx.workflowStep.createMany({
        data: [
          {
            workflowExecutionId: exec1.id,
            stepExecutorType: 'agent',
            stepName: 'Analyze Requirements',
            data: JSON.stringify({ phase: 'analysis' }),
            status: 'SUCCESS'
          },
          {
            workflowExecutionId: exec1.id,
            stepExecutorType: 'deterministic',
            stepName: 'Implement Core Engine',
            data: JSON.stringify({ phase: 'implementation' }),
            status: 'IN_PROGRESS',
            previousStepId: exec1.id
          },
          {
            workflowExecutionId: exec2.id,
            stepExecutorType: 'deterministic',
            stepName: 'Identify Root Cause',
            data: JSON.stringify({ issue: 'token-refresh' }),
            status: 'SUCCESS'
          },
          {
            workflowExecutionId: exec2.id,
            stepExecutorType: 'deterministic',
            stepName: 'Apply Fix',
            data: JSON.stringify({ fix: 'refresh-token-logic' }),
            status: 'SUCCESS'
          },
          {
            workflowExecutionId: exec3.id,
            stepExecutorType: 'agent',
            stepName: 'Create UI Components',
            data: JSON.stringify({ components: ['dashboard', 'sidebar'] }),
            status: 'SUCCESS'
          },
          {
            workflowExecutionId: exec3.id,
            stepExecutorType: 'deterministic',
            stepName: 'Integrate Styles',
            data: JSON.stringify({ theme: 'dark' }),
            status: 'SUCCESS'
          }
        ]
      });
      console.log(`    ✅ Created 6 workflow steps`);

      // Create Workflow Knowledge
      console.log('  Creating Workflow Knowledge...');
      await tx.workflowKnowledge.createMany({
        data: [
          {
            workflowExecutionId: exec1.id,
            checkpointId: generateId(),
            learningType: 'pattern',
            title: 'Async Execution Pattern',
            content: 'Use promises and async/await for sequential workflow execution',
            filePaths: ['workflow-engine.ts']
          },
          {
            workflowExecutionId: exec2.id,
            checkpointId: generateId(),
            learningType: 'bug-fix',
            title: 'Token Refresh Logic',
            content: 'Always validate token before refreshing and handle edge cases',
            filePaths: ['auth-service.ts', 'token-manager.ts']
          }
        ]
      });
      console.log(`    ✅ Created 2 workflow knowledge records`);

      // ============================================
      // PHASE 5: Forms & Other Entities
      // ============================================
      console.log('\n📦 Phase 5: Forms & Other Entities...');

      // Create Forms
      console.log('  Creating Forms...');
      const form1 = await tx.form.create({
        data: {
          formName: 'Ticket Details',
          formDescription: 'Additional ticket information form',
          entityType: FormEntityType.TICKET,
          contextType: FormContextType.BOARD,
          createdBy: user3.id
        }
      });

      const form2 = await tx.form.create({
        data: {
          formName: 'User Onboarding',
          formDescription: 'User onboarding checklist',
          entityType: FormEntityType.TICKET,
          contextType: FormContextType.BOARD,
          createdBy: user3.id
        }
      });
      console.log(`    ✅ Created 2 forms`);

      // Create Form Fields
      console.log('  Creating Form Fields...');
      await tx.formFields.createMany({
        data: [
          {
            formId: form1.id,
            fieldName: 'estimatedHours',
            fieldType: FormFieldType.NUMBER,
            isOptional: false
          },
          {
            formId: form1.id,
            fieldName: 'complexity',
            fieldType: FormFieldType.SINGLE_SELECT,
            fieldEnum: ['Low', 'Medium', 'High'].map(value => ({ id: randomUUID(), value })),
            isOptional: false
          },
          {
            formId: form2.id,
            fieldName: 'trainingCompleted',
            fieldType: FormFieldType.BOOLEAN,
            isOptional: false
          },
          {
            formId: form2.id,
            fieldName: 'assignedReviewer',
            fieldType: FormFieldType.USER,
            isOptional: false
          }
        ]
      });
      console.log(`    ✅ Created 4 form fields`);

      // Create Form Context Mappings (check if they already exist)
      console.log('  Creating Form Context Mappings...');
      const formContextMappings = [
        {
          formId: form1.id,
          contextId: board1.id,
          contextType: FormContextType.BOARD,
          entityType: FormEntityType.TICKET
        },
        {
          formId: form2.id,
          contextId: board2.id,
          contextType: FormContextType.BOARD,
          entityType: FormEntityType.TICKET
        }
      ];
      
      let createdContextMappings = 0;
      for (const mapping of formContextMappings) {
        const existing = await tx.formContextMapping.findUnique({
          where: {
            contextId_entityType: {
              contextId: mapping.contextId,
              entityType: mapping.entityType
            }
          }
        });
        
        if (!existing) {
          await tx.formContextMapping.create({ data: mapping });
          createdContextMappings++;
        }
      }
      console.log(`    ✅ Created ${createdContextMappings} form context mappings`);

      // Create Form Entity Values
      console.log('  Creating Form Entity Values...');
      await tx.formEntityValues.createMany({
        data: [
          {
            entityId: ticket1.id,
            entityType: 'TICKET',
            fieldId: generateId(),
            fieldValue: '40',
            actualFieldValue: 40
          },
          {
            entityId: ticket1.id,
            entityType: 'TICKET',
            fieldId: generateId(),
            fieldValue: 'High',
            actualFieldValue: 'High'
          }
        ]
      });
      console.log(`    ✅ Created 2 form entity values`);

      // ============================================
      // PHASE 6: Notifications, Calls & More
      // ============================================
      console.log('\n📦 Phase 6: Notifications, Calls & More...');

      // Create Notifications
      console.log('  Creating Notifications...');
      await tx.notification.createMany({
        data: [
          {
            userId: user1.id,
            type: NotificationType.TICKET_ASSIGNMENT,
            status: NotificationStatus.UNREAD,
            deliveryMethods: [NotificationDeliveryMethod.BROWSER],
            relatedEntityType: 'ticket',
            relatedEntityId: ticket1.id,
            actionUrl: `/tickets/${ticket1.xyneId}`
          },
          {
            userId: user1.id,
            type: NotificationType.MENTION,
            status: NotificationStatus.UNREAD,
            deliveryMethods: [NotificationDeliveryMethod.BROWSER],
            relatedEntityType: 'message',
            relatedEntityId: createdMessages[0].messageId,
            actionUrl: '/channels/general'
          },
          {
            userId: user2.id,
            type: NotificationType.WORKFLOW_COMPLETION,
            status: NotificationStatus.READ,
            deliveryMethods: [NotificationDeliveryMethod.BROWSER, NotificationDeliveryMethod.EMAIL],
            relatedEntityType: 'workflow',
            relatedEntityId: workflow2.id,
            actionUrl: `/tickets/${ticket2.xyneId}`
          },
          {
            userId: user3.id,
            type: NotificationType.TICKET_STATUS_CHANGE,
            status: NotificationStatus.UNREAD,
            deliveryMethods: [NotificationDeliveryMethod.BROWSER],
            relatedEntityType: 'ticket',
            relatedEntityId: ticket3.id,
            actionUrl: `/tickets/${ticket3.xyneId}`
          },
          {
            userId: user4.id,
            type: NotificationType.THREAD_REPLY,
            status: NotificationStatus.DISMISSED,
            deliveryMethods: [NotificationDeliveryMethod.BROWSER],
            relatedEntityType: 'message',
            relatedEntityId: createdMessages[10].messageId,
            actionUrl: '/channels/general'
          }
        ]
      });
      console.log(`    ✅ Created 5 notifications`);

      // Create Notification Preferences
      console.log('  Creating Notification Preferences...');
      await tx.notificationPreference.createMany({
        data: [
          {
            userId: user1.id,
            notificationType: NotificationType.TICKET_ASSIGNMENT,
            browserEnabled: true,
            emailEnabled: true
          },
          {
            userId: user1.id,
            notificationType: NotificationType.MENTION,
            browserEnabled: true,
            emailEnabled: false
          },
          {
            userId: user2.id,
            notificationType: NotificationType.TICKET_ASSIGNMENT,
            browserEnabled: false,
            emailEnabled: true
          }
        ]
      });
      console.log(`    ✅ Created 3 notification preferences`);

      // Create Activity Records
      console.log('  Creating Activity Records...');
      await tx.activity.createMany({
        data: [
          {
            userId: user1.id,
            actorId: createdMessages[2].senderId,
            actorAction: 'mentioned_user',
            actionSource: 'message',
            actionSourceId: createdMessages[2].messageId,
            messageId: createdMessages[2].messageId,
            channelId: generalChannel.id,
            classification: ActivityClassification.ACTIONABLE,
            classificationJobType: ActivityClassificationJobType.SINGLE,
            isRead: false
          },
          {
            userId: user3.id,
            actorId: createdMessages[3].senderId,
            actorAction: 'mentioned_user',
            actionSource: 'message',
            actionSourceId: createdMessages[3].messageId,
            messageId: createdMessages[3].messageId,
            channelId: generalChannel.id,
            classification: ActivityClassification.ACTIONABLE,
            classificationJobType: ActivityClassificationJobType.SPECIAL_MENTION_AUDIENCE,
            isRead: true
          },
          {
            userId: user2.id,
            actorId: createdMessages[1].senderId,
            actorAction: 'replied',
            actionSource: 'message',
            actionSourceId: createdMessages[1].messageId,
            messageId: createdMessages[1].messageId,
            channelId: generalChannel.id,
            classification: ActivityClassification.FYI,
            classificationJobType: ActivityClassificationJobType.SINGLE,
            isRead: false
          }
        ]
      });
      console.log(`    ✅ Created 3 activity records`);

      // Create Call
      console.log('  Creating Call...');
      const call1 = await tx.call.create({
        data: {
          externalId: generateId(),
          title: 'Sprint Planning Meeting',
          createdByUserId: user3.id,
          organizerId: user3.id,
          channelId: devChannel.id,
          orgName: org1.name,
          description: 'Weekly sprint planning session',
          callType: CallType.VIDEO,
          status: CallStatus.ENDED,
          recordingEnabled: false,
          startedAt: hoursAgo(2),
          endedAt: hoursAgo(1),
          lastActivityAt: hoursAgo(1),
          metadata: JSON.stringify({ participants: 4, duration: '1 hour' })
        }
      });
      console.log(`    ✅ Created 1 call`);

      // Create Call Participants
      console.log('  Creating Call Participants...');
      await tx.callParticipant.createMany({
        data: [
          {
            callId: call1.id,
            userId: user1.id,
            invitedBy: user3.id,
            response: InvitationResponse.ACCEPTED,
            joinedAt: hoursAgo(2),
            leftAt: hoursAgo(1)
          },
          {
            callId: call1.id,
            userId: user3.id,
            invitedBy: user3.id,
            response: InvitationResponse.ACCEPTED,
            joinedAt: hoursAgo(2),
            leftAt: hoursAgo(1)
          },
          {
            callId: call1.id,
            userId: user2.id,
            invitedBy: user3.id,
            response: InvitationResponse.ACCEPTED,
            joinedAt: hoursAgo(2),
            leftAt: hoursAgo(1)
          }
        ]
      });
      console.log(`    ✅ Created 3 call participants`);

      // Create Canvases
      console.log('  Creating Canvases...');
      const canvas1 = await tx.canvas.create({
        data: {
          title: 'Project Roadmap Q1 2026',
          content: JSON.stringify([
            { type: 'heading', content: 'Q1 2026 Goals' },
            { type: 'bullet', content: 'Launch workflow engine' },
            { type: 'bullet', content: 'Complete dashboard redesign' }
          ]),
          channelId: generalChannel.id,
          createdBy: user3.id,
          viewAccessId: generateId(),
          editAccessId: generateId(),
          visibility: CanvasVisibility.PUBLIC,
          isTemplate: false,
          docType: DocType.Canvas,
          isCollaborative: true
        }
      });

      const canvas2 = await tx.canvas.create({
        data: {
          title: 'Technical Documentation',
          content: JSON.stringify([
            { type: 'heading', content: 'Architecture' },
            { type: 'text', content: 'Microservices architecture...' }
          ]),
          channelId: devChannel.id,
          createdBy: user1.id,
          viewAccessId: generateId(),
          editAccessId: generateId(),
          visibility: CanvasVisibility.PRIVATE,
          isTemplate: true,
          docType: DocType.Canvas,
          isCollaborative: false
        }
      });
      console.log(`    ✅ Created 2 canvases`);

      // Create Canvas Participants
      console.log('  Creating Canvas Participants...');
      await tx.canvasParticipant.createMany({
        data: [
          {
            canvasId: canvas1.id,
            userId: user1.id,
            role: CanvasRole.EDITOR
          },
          {
            canvasId: canvas1.id,
            userId: user2.id,
            role: CanvasRole.VIEWER
          },
          {
            canvasId: canvas1.id,
            userId: user3.id,
            role: CanvasRole.OWNER
          },
          {
            canvasId: canvas2.id,
            userId: user1.id,
            role: CanvasRole.OWNER
          }
        ]
      });
      console.log(`    ✅ Created 4 canvas participants`);

      // Create Bookmarks
      console.log('  Creating Bookmarks...');
      await tx.bookmark.createMany({
        data: [
          {
            userId: user1.id,
            entityId: createdMessages[0].messageId,
            entityType: BookmarkEntityType.MESSAGE
          },
          {
            userId: user2.id,
            entityId: conv1.conversationId,
            entityType: BookmarkEntityType.CONVERSATION
          },
          {
            userId: user3.id,
            entityId: ticket1.id,
            entityType: BookmarkEntityType.TICKET
          },
          {
            userId: user1.id,
            entityId: canvas1.id,
            entityType: BookmarkEntityType.CANVAS
          }
        ]
      });
      console.log(`    ✅ Created 4 bookmarks`);

      // Create Pull Requests
      console.log('  Creating Pull Requests...');
      await tx.pullRequests.createMany({
        data: [
          {
            prId: 1234,
            repoName: 'xyne-spaces',
            sourceBranchName: 'feature/workflow-engine',
            destinationBranchName: 'develop',
            date: daysAgo(1),
            numberOfComments: 5,
            repositoryUrl: 'https://github.com/xyne/xyne-spaces',
            prUrl: 'https://github.com/xyne/xyne-spaces/pull/1234',
            status: PRStatus.OPEN,
            updatedAt: hoursAgo(1)
          },
          {
            prId: 1235,
            repoName: 'xyne-spaces',
            sourceBranchName: 'fix/auth-token',
            destinationBranchName: 'develop',
            date: daysAgo(2),
            numberOfComments: 3,
            repositoryUrl: 'https://github.com/xyne/xyne-spaces',
            prUrl: 'https://github.com/xyne/xyne-spaces/pull/1235',
            status: PRStatus.MERGED,
            updatedAt: hoursAgo(1)
          }
        ]
      });
      console.log(`    ✅ Created 2 pull requests`);

      // Create Knowledge Documents
      console.log('  Creating Knowledge Documents...');
      await tx.knowledgeDocument.createMany({
        data: [
          {
            projectId: project1.id,
            title: 'Workflow Engine Architecture',
            content: '## Architecture Overview\n\nThe workflow engine uses a directed acyclic graph (DAG)...',
            sourceKnowledgeId: generateId(),
            workflowExecutionId: exec1.id,
            conversationId: conv2.conversationId,
            approvedBy: user1.id,
            metadata: JSON.stringify({ tags: ['architecture', 'workflow'] })
          },
          {
            projectId: project1.id,
            title: 'Token Refresh Pattern',
            content: '## Token Refresh Pattern\n\nAlways validate tokens before refreshing...',
            sourceKnowledgeId: generateId(),
            workflowExecutionId: exec2.id,
            conversationId: conv2.conversationId,
            approvedBy: user1.id,
            metadata: JSON.stringify({ tags: ['security', 'auth'] })
          }
        ]
      });
      console.log(`    ✅ Created 2 knowledge documents`);

      // Create Vespa Insertion Logs
      console.log('  Creating Vespa Insertion Logs...');
      await tx.vespaInsertionLogs.createMany({
        data: [
          {
            entityId: ticket1.id,
            entityType: 'TICKET',
            type: VespaOperationType.INSERT,
            status: VespaInsertionStatus.PENDING,
            userId: user1.id
          },
          {
            entityId: ticket2.id,
            entityType: 'TICKET',
            type: VespaOperationType.UPDATE,
            status: VespaInsertionStatus.PENDING,
            userId: user4.id
          }
        ]
      });
      console.log(`    ✅ Created 2 vespa insertion logs`);

      // Create External Sources
      console.log('  Creating External Sources...');
      await tx.externalSource.create({
        data: {
          name: 'zoho-support',
          displayName: 'Zoho Support',
          sourceType: 'zoho',
          channelId: generalChannel.id,
          credentials: 'encrypted:credentials_here',
          isActive: true
        }
      });
      console.log(`    ✅ Created 1 external source`);

      // Create External Messages
      console.log('  Creating External Messages...');
      await tx.externalMessage.createMany({
        data: [
          {
            externalSourceId: 'zoho-support',
            externalId: 'zoho-msg-001',
            externalThreadId: 'zoho-thread-001',
            entityType: ExternalEntityType.MESSAGE,
            messageId: createdMessages[0].messageId,
            direction: MessageDirection.INCOMING
          },
          {
            externalSourceId: 'zoho-support',
            externalId: 'zoho-msg-002',
            externalThreadId: 'zoho-thread-001',
            entityType: ExternalEntityType.MESSAGE,
            messageId: createdMessages[1].messageId,
            direction: MessageDirection.INCOMING
          }
        ]
      });
      console.log(`    ✅ Created 2 external messages`);

      // Create Repos
      console.log('  Creating Repos...');
      await tx.repo.create({
        data: {
          name: 'xyne-spaces',
          url: 'https://github.com/xyne/xyne-spaces',
          baseBranch: JSON.stringify(['main', 'develop']),
          prefix: 'feature',
          createdBy: user1.id
        }
      });
      console.log(`    ✅ Created 1 repo`);

      // ============================================
      // SUMMARY
      // ============================================
      console.log('\n========================================');
      console.log('✅ Dummy data seeding completed successfully!');
      console.log('========================================');
      console.log('\n📊 Summary:');
      console.log('  Organizations: 2');
      console.log('  Users: 4');
      console.log('  User Groups: 3');
      console.log('  Projects: 2');
      console.log('  Boards: 2');
      console.log('  Stages: 6');
      console.log('  Channels: 3');
      console.log('  Conversations: 4');
      console.log('  Messages: 11');
      console.log('  Tickets: 3');
      console.log('  Workflows: 3');
      console.log('  Workflow Executions: 3');
      console.log('  Workflow Steps: 6');
      console.log('  Forms: 2');
      console.log('  Notifications: 5');
      console.log('  Calls: 1');
      console.log('  Canvases: 2');
      console.log('  Knowledge Documents: 2');
      console.log('\n🎉 All relationships maintained correctly!');
    });

  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Execute the seeding script when run directly
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Dummy seeding script failed:', error);
    process.exit(1);
  });

export { main as seedDummyData };
