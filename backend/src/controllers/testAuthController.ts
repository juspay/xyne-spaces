import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { UserService } from '@/services/userService';
import { UserSessionService } from '@/services/userSessionService';
import { jwtService } from '@/services/jwtService';
import { DatabaseClient } from '@/database/client';
import {
  AccessType,
  ActivityClassification,
  AuthProvider,
  BookmarkEntityType,
  CallOrigin,
  CallStatus,
  CallType,
  ChannelRole,
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  ConversationParticipation,
  InvitationResponse,
  MeetingStatus,
  ProjectType,
} from '@prisma/client';

/**
 * Test-only authentication endpoints that bypass Google OAuth.
 * @security NEVER expose in production!
 */
export class TestAuthController {
  private userService: UserService;
  private userSessionService: UserSessionService;

  // Shared org and workspace for all test users (created on first login)
  private static testOrgId: string | null = null;
  private static testWorkspaceId: string | null = null;

  constructor() {
    this.userService = new UserService();
    this.userSessionService = new UserSessionService();
  }

  private buildFixedTestUser() {
    const email = process.env.TEST_AUTH_EMAIL || 'test-user@xyne-test.local';
    const name = process.env.TEST_AUTH_NAME || 'Test User';

    return {
      googleId: `test-fixed-${email.replace(/[^a-zA-Z0-9]/g, '-')}`,
      email,
      name,
      picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
    };
  }

  private async seedChannelConversations(
    channelId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    const db = DatabaseClient.getInstance();
    const seedKey = 'thread-fixtures-v2';
    const THREAD_COUNT = 10;
    const MESSAGES_PER_THREAD = 5;

    const existing = await db.conversation.findFirst({
      where: {
        channelId,
        metadata: { path: ['seedKey'], equals: seedKey },
      },
    });
    if (existing) {
      return;
    }

    const baseTime = Date.now();

    for (let t = 1; t <= THREAD_COUNT; t++) {
      const threadStart = new Date(baseTime - (THREAD_COUNT - t) * 60_000);

      const conversation = await db.conversation.create({
        data: {
          channelId,
          createdBy: userId,
          initialMessageId: 'pending',
          lastActivityAt: threadStart,
          createdAt: threadStart,
          metadata: { seedKey, threadIndex: t },
        },
      });

      const initialMessage = await db.message.create({
        data: {
          conversationId: conversation.conversationId,
          senderId: userId,
          content: `<p>Seeded thread ${t} — opening message</p>`,
          showInChannel: false,
          createdAt: threadStart,
        },
      });

      let lastReplyAt = threadStart;
      for (let m = 1; m < MESSAGES_PER_THREAD; m++) {
        lastReplyAt = new Date(threadStart.getTime() + m * 1_000);
        await db.message.create({
          data: {
            conversationId: conversation.conversationId,
            senderId: userId,
            content: `<p>Seeded thread ${t} reply ${m}</p>`,
            showInChannel: false,
            createdAt: lastReplyAt,
          },
        });
      }

      await db.conversation.update({
        where: { conversationId: conversation.conversationId },
        data: {
          initialMessageId: initialMessage.messageId,
          replyCount: MESSAGES_PER_THREAD - 1,
          lastActivityAt: lastReplyAt,
        },
      });

      await db.conversationParticipant.create({
        data: {
          conversationId: conversation.conversationId,
          userId,
          participationType: ConversationParticipation.AUTHOR,
          isSubscribed: true,
          joinedAt: threadStart,
        },
      });
    }

    logger.info(
      `[${requestId}] Seeded ${THREAD_COUNT} conversations × ${MESSAGES_PER_THREAD} messages in channel ${channelId}`,
    );
  }

  private async seedChannelCalls(
    workspaceId: string,
    channelId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    const db = DatabaseClient.getInstance();
    const prefix = `test-call-${workspaceId.slice(-6)}`;
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const MIN = 60 * 1000;

    type CallSeed = {
      suffix: string;
      title: string;
      callType: CallType;
      status: CallStatus;
      startedAt: Date;
      endedAt: Date | null;
      startsAt?: Date;
      endsAt?: Date;
      recordingUrl?: string;
      transcript?: string;
      aiSummary?: string;
      participantResponse: InvitationResponse;
      meetingStatus: MeetingStatus;
      joinedAt?: Date;
      leftAt?: Date;
    };

    const seeds: CallSeed[] = [
      {
        suffix: 'video-ended-1',
        title: 'Sprint planning recap',
        callType: CallType.VIDEO,
        status: CallStatus.ENDED,
        startedAt: new Date(now - 3 * HOUR),
        endedAt: new Date(now - 3 * HOUR + 45 * MIN),
        recordingUrl: `gs://test-recordings/${prefix}-video-ended-1.mp4`,
        transcript: 'Alice: Welcome to sprint planning.\nBob: Let\'s review last sprint first.',
        aiSummary: '## Summary\n- Reviewed last sprint outcomes\n- Planned 8 stories for next sprint\n- Action: Bob to draft RFC',
        participantResponse: InvitationResponse.ACCEPTED,
        meetingStatus: MeetingStatus.ACCEPTED,
        joinedAt: new Date(now - 3 * HOUR),
        leftAt: new Date(now - 3 * HOUR + 45 * MIN),
      },
      {
        suffix: 'video-ended-2',
        title: 'Customer feedback sync',
        callType: CallType.VIDEO,
        status: CallStatus.ENDED,
        startedAt: new Date(now - 26 * HOUR),
        endedAt: new Date(now - 26 * HOUR + 30 * MIN),
        recordingUrl: `gs://test-recordings/${prefix}-video-ended-2.mp4`,
        transcript: 'PM: Top complaint this week was onboarding friction.',
        aiSummary: '## Summary\n- Onboarding friction is the #1 complaint\n- Plan: instrument funnel, ship inline tutorial',
        participantResponse: InvitationResponse.ACCEPTED,
        meetingStatus: MeetingStatus.ACCEPTED,
        joinedAt: new Date(now - 26 * HOUR),
        leftAt: new Date(now - 26 * HOUR + 30 * MIN),
      },
      {
        suffix: 'audio-ended-1',
        title: 'Quick 1:1',
        callType: CallType.AUDIO,
        status: CallStatus.ENDED,
        startedAt: new Date(now - 50 * HOUR),
        endedAt: new Date(now - 50 * HOUR + 15 * MIN),
        transcript: 'Audio-only catchup, no recording.',
        aiSummary: '## Summary\n- Status check, no blockers',
        participantResponse: InvitationResponse.ACCEPTED,
        meetingStatus: MeetingStatus.ACCEPTED,
        joinedAt: new Date(now - 50 * HOUR),
        leftAt: new Date(now - 50 * HOUR + 15 * MIN),
      },
      {
        suffix: 'video-active-1',
        title: 'Live: design review',
        callType: CallType.VIDEO,
        status: CallStatus.ACTIVE,
        startedAt: new Date(now - 10 * MIN),
        endedAt: null,
        participantResponse: InvitationResponse.ACCEPTED,
        meetingStatus: MeetingStatus.ACCEPTED,
        joinedAt: new Date(now - 10 * MIN),
      },
      {
        suffix: 'video-scheduled-1',
        title: 'Upcoming: roadmap sync',
        callType: CallType.VIDEO,
        status: CallStatus.SCHEDULED,
        startedAt: new Date(now + HOUR),
        endedAt: null,
        startsAt: new Date(now + HOUR),
        endsAt: new Date(now + HOUR + 30 * MIN),
        participantResponse: InvitationResponse.INVITED,
        meetingStatus: MeetingStatus.PENDING,
      },
      {
        suffix: 'video-missed-1',
        title: 'Missed: design crit',
        callType: CallType.VIDEO,
        status: CallStatus.ENDED,
        startedAt: new Date(now - 8 * HOUR),
        endedAt: new Date(now - 8 * HOUR + 25 * MIN),
        recordingUrl: `gs://test-recordings/${prefix}-video-missed-1.mp4`,
        transcript: 'Designer walked through 3 mocks. No major objections.',
        aiSummary: '## Summary\n- 3 mocks reviewed; option B preferred',
        participantResponse: InvitationResponse.MISSED,
        meetingStatus: MeetingStatus.PENDING,
      },
    ];

    let created = 0;
    for (const s of seeds) {
      const externalId = `${prefix}-${s.suffix}`;
      const existing = await db.call.findUnique({ where: { externalId } });
      if (existing) continue;

      const call = await db.call.create({
        data: {
          externalId,
          title: s.title,
          createdByUserId: userId,
          organizerId: userId,
          channelId,
          callType: s.callType,
          callOrigin: CallOrigin.CHANNEL,
          status: s.status,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          recordingEnabled: !!s.recordingUrl,
          recordingUrl: s.recordingUrl,
          transcript: s.transcript,
          aiSummary: s.aiSummary,
          lastActivityAt: s.endedAt ?? s.startedAt,
        },
      });

      await db.callParticipant.create({
        data: {
          callId: call.id,
          userId,
          invitedBy: userId,
          response: s.participantResponse,
          meetingStatus: s.meetingStatus,
          respondedAt: s.startedAt,
          joinedAt: s.joinedAt,
          leftAt: s.leftAt,
        },
      });

      created++;
    }

    if (created > 0) {
      logger.info(`[${requestId}] Seeded ${created} call fixtures in channel ${channelId}`);
    }
  }

  private async seedBuddyUsers(
    workspaceId: string,
    requestId: string,
  ): Promise<Array<{ id: string; email: string; name: string }>> {
    const db = DatabaseClient.getInstance();
    const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) return [];

    const specs = [
      { suffix: '1', name: 'Seed Buddy One' },
      { suffix: '2', name: 'Seed Buddy Two' },
      { suffix: '3', name: 'Seed Buddy Three' },
    ];

    const buddies: Array<{ id: string; email: string; name: string }> = [];
    for (const spec of specs) {
      const email = `seed-buddy-${spec.suffix}@xyne-test.local`;
      let user = await db.user.findFirst({ where: { email, workspaceId } });
      if (!user) {
        let orgMember = await db.orgMember.findUnique({ where: { email } });
        if (!orgMember) {
          orgMember = await db.orgMember.create({
            data: { orgId: workspace.orgId, email, role: 'MEMBER' },
          });
        }
        user = await db.user.create({
          data: {
            providerUserId: `seed-buddy-${spec.suffix}`,
            email,
            name: spec.name,
            picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(spec.name)}&background=random`,
            authProvider: AuthProvider.GOOGLE,
            workspace: { connect: { id: workspaceId } },
            role: 'MEMBER',
            orgMemberId: orgMember.memberId,
          },
        });
      }
      buddies.push({ id: user.id, email: user.email, name: user.name });
    }

    logger.info(`[${requestId}] Seeded ${buddies.length} buddy users`);
    return buddies;
  }

  private async seedDmChannels(
    workspaceId: string,
    userId: string,
    buddies: Array<{ id: string; name: string }>,
    requestId: string,
  ): Promise<void> {
    const db = DatabaseClient.getInstance();

    let dmProject = await db.project.findFirst({
      where: { workspaceId, code: 'DM', type: ProjectType.DM },
    });
    if (!dmProject) {
      dmProject = await db.project.create({
        data: {
          name: 'Direct Messages',
          code: 'DM',
          description: 'Seeded DM project',
          workspaceId,
          type: ProjectType.DM,
          createdBy: userId,
        },
      });
    }

    const seedKey = 'dm-fixtures-v1';

    for (const buddy of buddies) {
      const dmName = [userId, buddy.id].sort().join(',');
      let channel = await db.channel.findFirst({
        where: { name: dmName, scopeType: ChannelScopeType.DM, projectId: dmProject.id },
      });
      if (!channel) {
        channel = await db.channel.create({
          data: {
            name: dmName,
            description: `DM with ${buddy.name}`,
            type: ChannelType.DEFAULT,
            scopeType: ChannelScopeType.DM,
            visibility: ChannelVisibility.PRIVATE,
            createdBy: userId,
            projectId: dmProject.id,
            workspaceId,
          },
        });
      }

      const channelTouchAt = new Date();
      for (const uid of [userId, buddy.id]) {
        await db.channelParticipant.upsert({
          where: { channelId_userId: { channelId: channel.id, userId: uid } },
          update: {},
          create: { channelId: channel.id, userId: uid, role: ChannelRole.MEMBER },
        });
        await db.channelUserStatus.upsert({
          where: { channelId_userId: { channelId: channel.id, userId: uid } },
          update: { isClosed: false, isDeleted: false, updatedAt: channelTouchAt },
          create: {
            channelId: channel.id,
            userId: uid,
            isClosed: false,
            isDeleted: false,
            updatedAt: channelTouchAt,
          },
        });
      }

      const existingConv = await db.conversation.findFirst({
        where: { channelId: channel.id, metadata: { path: ['seedKey'], equals: seedKey } },
      });
      if (existingConv) continue;

      const baseTime = Date.now() - 30 * 60_000;
      const messages: Array<{ sender: string; content: string }> = [
        { sender: userId, content: `<p>Hey ${buddy.name}, got a sec?</p>` },
        { sender: buddy.id, content: `<p>Yep, what's up?</p>` },
        { sender: userId, content: `<p>Quick design question for you.</p>` },
        { sender: buddy.id, content: `<p>Shoot.</p>` },
      ];

      const conversation = await db.conversation.create({
        data: {
          channelId: channel.id,
          createdBy: userId,
          initialMessageId: 'pending',
          lastActivityAt: new Date(baseTime),
          createdAt: new Date(baseTime),
          metadata: { seedKey },
        },
      });

      let firstMessageId = '';
      let lastMsgAt = new Date(baseTime);
      for (let i = 0; i < messages.length; i++) {
        const ts = new Date(baseTime + i * 60_000);
        const msg = await db.message.create({
          data: {
            conversationId: conversation.conversationId,
            senderId: messages[i]!.sender,
            content: messages[i]!.content,
            showInChannel: false,
            createdAt: ts,
          },
        });
        if (i === 0) firstMessageId = msg.messageId;
        lastMsgAt = ts;
      }

      await db.conversation.update({
        where: { conversationId: conversation.conversationId },
        data: {
          initialMessageId: firstMessageId,
          replyCount: messages.length - 1,
          lastActivityAt: lastMsgAt,
        },
      });

      for (const uid of [userId, buddy.id]) {
        await db.conversationParticipant.create({
          data: {
            conversationId: conversation.conversationId,
            userId: uid,
            participationType: ConversationParticipation.AUTHOR,
            isSubscribed: true,
            joinedAt: new Date(baseTime),
          },
        });
      }
    }

    logger.info(`[${requestId}] Seeded ${buddies.length} DM channels`);
  }

  private async seedActivities(
    userId: string,
    channelId: string,
    buddies: Array<{ id: string; name: string }>,
    requestId: string,
  ): Promise<void> {
    if (buddies.length === 0) return;
    const db = DatabaseClient.getInstance();

    const conversations = await db.conversation.findMany({
      where: { channelId, metadata: { path: ['seedKey'], equals: 'thread-fixtures-v2' } },
      take: 5,
      orderBy: { createdAt: 'asc' },
    });
    if (conversations.length === 0) return;

    const HOUR = 60 * 60 * 1000;
    const now = Date.now();
    const buddy = (i: number) => buddies[i % buddies.length]!;

    const seeds: Array<{
      conv: typeof conversations[number];
      actorIdx: number;
      action: string;
      classification: ActivityClassification;
      isRead: boolean;
      offsetMs: number;
    }> = [
      { conv: conversations[0]!, actorIdx: 0, action: 'mentioned_user', classification: ActivityClassification.ACTIONABLE, isRead: false, offsetMs: -2 * HOUR },
      { conv: conversations[0]!, actorIdx: 1, action: 'replied', classification: ActivityClassification.FYI, isRead: false, offsetMs: -90 * 60_000 },
      { conv: conversations[1]!, actorIdx: 2, action: 'reaction', classification: ActivityClassification.FYI, isRead: true, offsetMs: -30 * 60_000 },
      { conv: conversations[2]!, actorIdx: 0, action: 'mentioned_user', classification: ActivityClassification.FYI, isRead: false, offsetMs: -10 * 60_000 },
      { conv: conversations[3]!, actorIdx: 1, action: 'replied', classification: ActivityClassification.SKIP, isRead: true, offsetMs: -25 * HOUR },
    ];

    let created = 0;
    for (const s of seeds) {
      if (!s.conv) continue;
      const actor = buddy(s.actorIdx);
      const messageId = s.conv.initialMessageId;

      const exists = await db.activity.findFirst({
        where: {
          userId,
          actorId: actor.id,
          actorAction: s.action,
          messageId,
          conversationId: s.conv.conversationId,
        },
      });
      if (exists) continue;

      await db.activity.create({
        data: {
          userId,
          actorId: actor.id,
          actorAction: s.action,
          actionSource: 'message',
          actionSourceId: messageId,
          messageId,
          conversationId: s.conv.conversationId,
          channelId,
          classification: s.classification,
          isRead: s.isRead,
          createdAt: new Date(now + s.offsetMs),
        },
      });
      created++;
    }

    if (created > 0) {
      logger.info(`[${requestId}] Seeded ${created} activities for user ${userId}`);
    }
  }

  private async seedBookmarks(
    userId: string,
    channelId: string,
    requestId: string,
  ): Promise<void> {
    const db = DatabaseClient.getInstance();

    const conversations = await db.conversation.findMany({
      where: { channelId, metadata: { path: ['seedKey'], equals: 'thread-fixtures-v2' } },
      take: 3,
      orderBy: { createdAt: 'asc' },
    });
    if (conversations.length === 0) return;

    let created = 0;
    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i]!;

      const convBookmark = await db.bookmark.upsert({
        where: {
          userId_entityId_entityType: {
            userId,
            entityId: conv.conversationId,
            entityType: BookmarkEntityType.CONVERSATION,
          },
        },
        update: {},
        create: {
          userId,
          entityId: conv.conversationId,
          entityType: BookmarkEntityType.CONVERSATION,
          isCompleted: i === 0,
        },
      });
      if (convBookmark) created++;

      if (conv.initialMessageId && conv.initialMessageId !== 'pending') {
        await db.bookmark.upsert({
          where: {
            userId_entityId_entityType: {
              userId,
              entityId: conv.initialMessageId,
              entityType: BookmarkEntityType.MESSAGE,
            },
          },
          update: {},
          create: {
            userId,
            entityId: conv.initialMessageId,
            entityType: BookmarkEntityType.MESSAGE,
          },
        });
        created++;
      }
    }

    if (created > 0) {
      logger.info(`[${requestId}] Seeded ${created} bookmarks for user ${userId}`);
    }
  }

  private async seedWorkspaceFixtures(workspaceId: string, userId: string, requestId: string): Promise<void> {
    const db = DatabaseClient.getInstance();
    const now = new Date();

    let project = await db.project.findFirst({ where: { workspaceId, code: 'TST' } });
    if (!project) {
      project = await db.project.create({
        data: {
          name: 'Test Project',
          code: 'TST',
          description: 'Project seeded for dev:test',
          workspaceId,
          type: ProjectType.DEFAULT,
          createdBy: userId,
        },
      });
    }

    const seededChannelIds: string[] = [];
    for (const channelName of ['general', 'test-automation']) {
      let channel = await db.channel.findFirst({
        where: { workspaceId, projectId: project.id, name: channelName },
      });

      if (!channel) {
        channel = await db.channel.create({
          data: {
            name: channelName,
            description: `Seeded channel: ${channelName}`,
            type: ChannelType.DEFAULT,
            scopeType: ChannelScopeType.DEFAULT,
            visibility: ChannelVisibility.PUBLIC,
            createdBy: userId,
            projectId: project.id,
            workspaceId,
          },
        });
      }

      seededChannelIds.push(channel.id);

      if (channelName === 'general') {
        await this.seedChannelConversations(channel.id, userId, requestId);
      }

      await db.channelParticipant.upsert({
        where: { channelId_userId: { channelId: channel.id, userId } },
        update: { role: ChannelRole.ADMIN },
        create: {
          channelId: channel.id,
          userId,
          role: ChannelRole.ADMIN,
        },
      });

      await db.channelUserStatus.upsert({
        where: { channelId_userId: { channelId: channel.id, userId } },
        update: {
          isClosed: false,
          isDeleted: false,
          updatedAt: now,
        },
        create: {
          channelId: channel.id,
          userId,
          isClosed: false,
          isDeleted: false,
          updatedAt: now,
        },
      });
    }

    for (const suffix of ['rec-1', 'rec-2']) {
      const externalId = `test-headless-${workspaceId.slice(-6)}-${suffix}`;
      const existingCall = await db.call.findUnique({ where: { externalId } });
      if (!existingCall) {
        await db.call.create({
          data: {
            externalId,
            title: `Seeded Recording ${suffix.toUpperCase()}`,
            createdByUserId: userId,
            channelId: seededChannelIds[0],
            callType: CallType.HEADLESS,
            status: CallStatus.ENDED,
            transcript: `Seeded transcript for ${externalId}`,
            aiSummary: `## Summary\nSeeded summary for ${externalId}`,
            startedAt: now,
            endedAt: now,
            lastActivityAt: now,
          },
        });
      }
    }

    if (seededChannelIds[0]) {
      await this.seedChannelCalls(workspaceId, seededChannelIds[0], userId, requestId);
    }

    const buddies = await this.seedBuddyUsers(workspaceId, requestId);
    if (buddies.length > 0) {
      for (const channelId of seededChannelIds) {
        for (const buddy of buddies) {
          await db.channelParticipant.upsert({
            where: { channelId_userId: { channelId, userId: buddy.id } },
            update: {},
            create: { channelId, userId: buddy.id, role: ChannelRole.MEMBER },
          });
          await db.channelUserStatus.upsert({
            where: { channelId_userId: { channelId, userId: buddy.id } },
            update: {},
            create: {
              channelId,
              userId: buddy.id,
              isClosed: false,
              isDeleted: false,
              updatedAt: now,
            },
          });
        }
      }
      await this.seedDmChannels(workspaceId, userId, buddies, requestId);
      if (seededChannelIds[0]) {
        await this.seedActivities(userId, seededChannelIds[0], buddies, requestId);
      }
    }
    if (seededChannelIds[0]) {
      await this.seedBookmarks(userId, seededChannelIds[0], requestId);
    }

    const workflowName = 'seeded-test-workflow';
    let workflow = await db.workflow.findFirst({
      where: { workflowName, metadata: workspaceId },
    });

    if (!workflow) {
      workflow = await db.workflow.create({
        data: {
          workflowName,
          metadata: workspaceId,
          status: 'SUCCESS',
        },
      });

      const execution = await db.workflowExecution.create({
        data: {
          workflowId: workflow.id,
          workflowType: 'seeded',
          status: 'SUCCESS',
          tag: 'root',
          createdBy: userId,
        },
      });

      await db.workflowStep.create({
        data: {
          workflowExecutionId: execution.id,
          stepExecutorType: 'deterministic',
          stepName: 'seeded-step',
          status: 'SUCCESS',
          data: JSON.stringify({ workspaceId, userId }),
        },
      });
    }

    logger.info(`[${requestId}] Seeded test fixtures for workspace ${workspaceId}`);
  }

  testLogin = async (req: Request, res: Response): Promise<void> => {
    const requestId = `TEST_LOGIN_${Date.now()}`;

    try {
      const enableDevAuth = process.env.ENABLE_DEV_AUTH === 'true' && process.env.NODE_ENV === 'development';
      if (!config.isTestEnv && !enableDevAuth) {
        logger.error(`[${requestId}] Test login attempted in non-test environment!`);
        res.status(403).json({
          error: 'Forbidden',
          message: 'Test authentication is only available in test environment',
        });
        return;
      }

      const isAdmin = req.body.isAdmin === true || req.query.isAdmin === 'true';
      const useFixedUser = config.isTestEnv || req.query.fixed === 'true' || req.body.fixed === true;

      let testUserData;
      if (enableDevAuth && process.env.DEFAULT_ADMIN_EMAIL) {
        const adminEmail = process.env.DEFAULT_ADMIN_EMAIL;
        const emailUser = adminEmail.split('@')[0];
        const name = emailUser
          .split(/[.\-_]/)
          .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
        testUserData = {
          googleId: `dev-admin-${adminEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
          email: adminEmail,
          name: name || 'Sandbox Admin',
          picture: 'https://ui-avatars.com/api/?name=Sandbox+Admin&background=random',
        };
      } else if (useFixedUser) {
        testUserData = this.buildFixedTestUser();
      } else {
        const unique = Date.now();
        testUserData = {
          googleId: `test-user-id-${unique}`,
          email: `test-user-email-${unique}@xyne-test.local`,
          name: `Test User ${unique}`,
          picture: `https://ui-avatars.com/api/?name=User+${unique}&background=random`,
        };
      }

      let organization: any;
      let workspace: any;
      let user: any;
      let isNewUser = true;
      const db = DatabaseClient.getInstance();

      // Recover org/workspace IDs from DB if lost after server restart
      if (!TestAuthController.testOrgId) {
        const existingOrg = await db.organization.findUnique({
          where: { name: 'Test Org' },
        });
        if (existingOrg) {
          const existingWorkspace = await db.workspace.findFirst({
            where: { orgId: existingOrg.orgId },
          });
          if (existingWorkspace) {
            TestAuthController.testOrgId = existingOrg.orgId;
            TestAuthController.testWorkspaceId = existingWorkspace.id;
            logger.info(`[${requestId}] Recovered test org/workspace IDs from DB after restart`);
          }
        }
      }

      if (!TestAuthController.testOrgId) {
        // First test login: create org + workspace + user
        logger.info(`[${requestId}] First test login - creating org, workspace, and user: ${testUserData.email}`);

        const result = await this.userService.createOrganizationWithUser(
          {
            providerUserId: testUserData.googleId,
            email: testUserData.email,
            name: testUserData.name,
            picture: testUserData.picture,
          },
          'Test Org',
          'Test Workspace',
          'GOOGLE',
        );

        organization = result.organization;
        workspace = result.workspace;
        user = result.workspaceUser;

        // Store org and workspace IDs for subsequent logins
        TestAuthController.testOrgId = organization.orgId;
        TestAuthController.testWorkspaceId = workspace.id;
      } else {
        // Subsequent test logins: reuse existing org + workspace, reuse fixed user
        logger.info(`[${requestId}] Subsequent test login - adding user to existing org/workspace: ${testUserData.email}`);

        organization = await db.organization.findUnique({
          where: { orgId: TestAuthController.testOrgId! },
        });
        workspace = await db.workspace.findUnique({
          where: { id: TestAuthController.testWorkspaceId! },
        });

        // Fetch existing orgMember by email
        let orgMember = await db.orgMember.findUnique({
          where: { email: testUserData.email },
          select: { memberId: true },
        });

        // Create OrgMember if it doesn't exist
        if (!orgMember) {
          orgMember = await db.orgMember.create({
            data: {
              orgId: TestAuthController.testOrgId!,
              email: testUserData.email,
              role: 'MEMBER',
            },
            select: { memberId: true },
          });
        }

        // Create user in the existing workspace (or reuse if already exists)
        const existingUser = await db.user.findFirst({
          where: { email: testUserData.email, workspaceId: TestAuthController.testWorkspaceId! },
        });

        if (existingUser) {
          user = existingUser;
          isNewUser = false;
        } else {
          user = await db.user.create({
            data: {
              providerUserId: testUserData.googleId,
              email: testUserData.email,
              name: testUserData.name,
              picture: testUserData.picture,
              authProvider: 'GOOGLE' as AuthProvider,
              workspace: { connect: { id: TestAuthController.testWorkspaceId! } },
              role: 'MEMBER',
              orgMemberId: orgMember.memberId,
            },
          });
        }
      }

      logger.info(`[${requestId}] Org ${organization.orgId}, workspace ${workspace.id}, user ${user.id}`);

      await this.seedWorkspaceFixtures(workspace.id, user.id, requestId);

      if (isAdmin) {
        try {
          // Grant admin access to all resources for comprehensive testing
          const essentialResources = [
            { name: 'TICKETS', description: 'Ticket management endpoints' },
            { name: 'KNOWLEDGE-BASE', description: 'Knowledge base management' },
            { name: 'ANALYTICS', description: 'Analytics and reporting' },
            { name: 'USER-GROUPS', description: 'User group management' },
            { name: 'LISTPROJECTS', description: 'Project list view' },
            { name: 'USERS', description: 'User management endpoints' },
            { name: 'FORMS', description: 'Form management' },
            { name: 'SUPPORT', description: 'Support ticket management' },
            { name: 'PRODUCT-INSIGHTS', description: 'Product insights and analytics' },
            { name: 'PROJECTS', description: 'Project board management' },
          ];

          for (const resourceData of essentialResources) {
            const existingResource = await db.resource.findUnique({
              where: { name: resourceData.name },
            });

            if (!existingResource) {
              await db.resource.create({
                data: resourceData,
              });
              logger.info(`[${requestId}] Created essential resource: ${resourceData.name}`);
            }
          }

          const resources = await db.resource.findMany();
          for (const resource of resources) {
            const existingAccess = await db.resourceAccess.findFirst({
              where: {
                userId: user.id,
                resourceId: resource.id,
              },
            });

            if (!existingAccess) {
              await db.resourceAccess.create({
                data: {
                  userId: user.id,
                  resourceId: resource.id,
                  accessType: AccessType.ADMIN,
                },
              });
              logger.info(`[${requestId}] Granted ADMIN access to resource ${resource.name} for user ${user.email}`);
            } else if (existingAccess.accessType !== AccessType.ADMIN) {
              await db.resourceAccess.update({
                where: { id: existingAccess.id },
                data: { accessType: AccessType.ADMIN },
              });
              logger.info(`[${requestId}] Updated access to ADMIN for resource ${resource.name} for user ${user.email}`);
            }
          }
        } catch (orgError) {
          logger.error(`[${requestId}] Failed to add user to default organization or grant admin access:`, orgError);
        }
      }

      // Email is globally unique in orgMember, single lookup is sufficient
      const orgMember = await db.orgMember.findUnique({
        where: { email: user.email },
      });
      if (!orgMember) {
        throw new Error(`User ${user.email} is not a member of any organization`);
      }

      const customToken = jwtService.generateToken({
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: testUserData.picture,
        workspaceId: user.workspaceId,
        memberId: orgMember.memberId,
      });

      let sessionId = null;
      try {
        logger.info(`[${requestId}] Creating test user session`);

        const refreshTokenExpiry = new Date();
        refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + config.session.expiryDays);

        const deviceInfo = JSON.stringify({
          userAgent: req.headers['user-agent'] || 'Test Automation',
          timestamp: new Date().toISOString(),
          platform: 'test',
        });

        const refreshToken = `test-${randomBytes(32).toString('hex')}-${Date.now()}`;

        const session = await this.userSessionService.createSession({
          userId: user.id,
          refreshToken,
          refreshTokenExpiry,
          deviceInfo,
          ipAddress: req.ip || '127.0.0.1',
        });

        sessionId = session.id;
        logger.info(`[${requestId}] Session created: ${sessionId}`);
      } catch (sessionError) {
        logger.error(`[${requestId}] Session creation failed:`, sessionError);
      }

      const cookieOptions = {
        httpOnly: true,
        secure: false,
        sameSite: 'strict' as const,
        path: '/',
      };

      // Set workspace-scoped JWT token (matches authV2Middleware expectation)
      res.cookie(`xyne_ws_${user.workspaceId}_token`, customToken, {
        ...cookieOptions,
        maxAge: 24 * 60 * 60 * 1000,
      });

      // Set last workspace pointer so authV2Middleware can find the right token
      res.cookie('xyne_last_workspace', user.workspaceId, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      if (sessionId) {
        res.cookie('xyne_session', sessionId, {
          ...cookieOptions,
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });
      }

      if (isNewUser) {
        res.cookie('is_new_user', 'true', {
          httpOnly: false,
          secure: false,
          sameSite: 'strict',
          path: '/',
          maxAge: config.session.expiryDays * 24 * 60 * 60 * 1000,
        });
      }

      logger.info(`[${requestId}] Test login successful for: ${user.email}`);

      res.status(200).json({
        success: true,
        message: 'Test login successful',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isNewUser,
          workspaceId: user.workspaceId,
          role: user.role,
          orgRole: orgMember.role,
          memberId: orgMember.memberId,
        },
        sessionId,
      });
    } catch (error) {
      logger.error(`[${requestId}] Test login failed:`, error);

      res.status(500).json({
        error: 'Test login failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  testLogout = async (req: Request, res: Response): Promise<void> => {
    const requestId = `TEST_LOGOUT_${Date.now()}`;

    try {
      logger.info(`[${requestId}] Test logout initiated`);

      // Clear all workspace-scoped token cookies
      for (const cookieName of Object.keys(req.cookies || {})) {
        if (cookieName.startsWith('xyne_ws_') && cookieName.endsWith('_token')) {
          res.clearCookie(cookieName, { path: '/' });
        }
      }
      res.clearCookie('xyne_last_workspace', { path: '/' });
      res.clearCookie('xyne_session', { path: '/' });
      res.clearCookie('is_new_user', { path: '/' });

      res.status(200).json({
        success: true,
        message: 'Test logout successful',
      });
    } catch (error) {
      logger.error(`[${requestId}] Test logout failed:`, error);

      res.status(500).json({
        error: 'Test logout failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}
