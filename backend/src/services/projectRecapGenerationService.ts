import { db } from '../database/client';
import { logger } from '../utils/logger';
import { AgentsConfig } from '../agents/config';
import { redisService } from './redisService';
import { getPrompt, PROMPT_NAMES } from '../agents/xyne-ai/langfuse/prompts.js';
import { compileFallbackPrompt } from '../agents/xyne-ai/langfuse/fallback-prompts.js';
import { CacConfigService } from './cacConfigService';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

async function getProjectRecapPrompt(
  promptName: string,
  variables: Record<string, string>,
): Promise<string> {
  try {
    const langfusePrompt = await getPrompt(promptName);
    if (langfusePrompt) {
      const compiled: unknown = langfusePrompt.compile(variables);
      if (typeof compiled === 'string' && compiled.length > 0) return compiled;
    }
  } catch {
    logger.debug(`[ProjectRecap] Langfuse unavailable for "${promptName}", using fallback`);
  }
  const fallback = compileFallbackPrompt(promptName, variables);
  if (!fallback) throw new Error(`No fallback prompt found for "${promptName}"`);
  return fallback;
}

// ============================================================================
// Types
// ============================================================================

export interface ProjectRecapPoint {
  point: string;
  channelId: string;
  channelName: string;
  citationIndex: number;
  conversationId?: string;
  messageId?: string;
}

export interface ProjectRecapSummary {
  projectName: string;
  projectId: string;
  summary: string;
  good: ProjectRecapPoint[];
  bad: ProjectRecapPoint[];
  channelCount: number;
  messageCount: number;
}

interface ProjectRecapResult {
  projectId: string;
  userId: string;
  success: boolean;
  error?: string;
  summary?: ProjectRecapSummary;
}

interface ConversationAnchor {
  conversationId: string;
  messageId: string;
}

interface ChannelVerboseSummary {
  channelId: string;
  channelName: string;
  summary: string;
  messageCount: number;
  hasActivity: boolean;
  conversationAnchors: ConversationAnchor[];
}

// ============================================================================
// Constants
// ============================================================================

const REDIS_CHANNEL_SUMMARY_TTL = 48 * 60 * 60; // 48 hours

// ============================================================================
// Helpers
// ============================================================================

function getDateRangeInTimezone(date: Date): { startOfDay: Date; endOfDay: Date; dateStr: string } {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const startOfDay = new Date(`${dateStr}T00:00:00+05:30`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999+05:30`);
  return { startOfDay, endOfDay, dateStr };
}

async function callLLM(userPrompt: string, systemPrompt: string, projectId: string): Promise<string> {
  const agentsConfig = AgentsConfig.defaults();
  const credential = await orgLLMCredentialService.getCredentialByProjectId(
    projectId,
    OrgLLMServiceAccountPurpose.DEFAULT,
  );
  if (!credential) {
    throw new Error('LiteLLM credentials are not configured for this organization');
  }

  const baseUrl = credential.baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential.apiKey}`,
    },
    body: JSON.stringify({
      model: agentsConfig.summariserModelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`LiteLLM error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

// ============================================================================
// Service
// ============================================================================

export class ProjectRecapGenerationService {
  /**
   * Generate recaps for all subscribed projects for a given date.
   *
   * Architecture:
   *   Pass 1 — one verbose LLM call per channel, results cached in Redis (shared across users).
   *   Pass 2 — one aggregation call per (project, user) using only the channels that user is a
   *            member of. Produces one ProjectRecap row per (projectId, userId, recapDate).
   */
  async generateRecapsForDate(targetDate: Date): Promise<{
    totalProjects: number;
    successful: number;
    failed: number;
    results: ProjectRecapResult[];
  }> {
    const { dateStr } = getDateRangeInTimezone(targetDate);
    logger.info(`[ProjectRecap] Starting generation for date: ${dateStr} (IST)`);

    // Fetch all users and filter by CAC whitelist (project_recap_enabled per email)
    const allUsers = await db.user.findMany({
      select: { id: true, email: true },
    });

    const users: { id: string; email: string }[] = [];
    for (const user of allUsers) {
      const enabled = await CacConfigService.fetch(
        'project_recap_enabled',
        user.email ? { email: user.email } : undefined,
      );
      if (enabled) users.push(user);
    }

    logger.info(`[ProjectRecap] Processing ${users.length}/${allUsers.length} users (CAC-enabled)`);

    // For each user, find projects where they are members of channels
    const projectSubscribers = new Map<string, string[]>();
    
    for (const user of users) {
      // Find all channels this user is a member of
      const userChannelMemberships = await db.channelParticipant.findMany({
        where: { userId: user.id },
        select: { channelId: true },
      });
      
      const channelIds = userChannelMemberships.map(c => c.channelId);
      
      if (channelIds.length === 0) {
        logger.debug(`[ProjectRecap] User ${user.id} is not in any channels, skipping`);
        continue;
      }
      
      // Find all projects these channels belong to
      const channels = await db.channel.findMany({
        where: { id: { in: channelIds } },
        select: { projectId: true },
      });
      
      // Get unique project IDs
      const projectIds = [...new Set(channels.map(c => c.projectId).filter(Boolean))];
      
      // Add user to each project's subscriber list
      for (const projectId of projectIds) {
        if (!projectId) continue;
        const list = projectSubscribers.get(projectId) ?? [];
        if (!list.includes(user.id)) {
          list.push(user.id);
          projectSubscribers.set(projectId, list);
        }
      }
      
      logger.debug(`[ProjectRecap] User ${user.id}: subscribed to ${projectIds.length} projects based on channel membership`);
    }

    const projectIds = [...projectSubscribers.keys()];
    logger.info(`[ProjectRecap] Processing ${projectIds.length} projects with subscribers`);

    const results: ProjectRecapResult[] = [];
    const failed: Array<{ projectId: string; userId: string }> = [];

    for (const projectId of projectIds) {
      const subscriberIds = projectSubscribers.get(projectId)!;
      const projectResults = await this.generateRecapForProject(projectId, targetDate, subscriberIds);
      for (const r of projectResults) {
        results.push(r);
        if (!r.success) failed.push({ projectId: r.projectId, userId: r.userId });
      }
    }

    // Retry failures once
    if (failed.length > 0) {
      logger.info(`[ProjectRecap] Retrying ${failed.length} failed (project, user) pairs`);
      for (const { projectId, userId } of failed) {
        try {
          const retried = await this.generateRecapForProject(projectId, targetDate, [userId]);
          const idx = results.findIndex((r) => r.projectId === projectId && r.userId === userId);
          if (idx !== -1 && retried[0]) results[idx] = retried[0];
        } catch (error) {
          logger.error(`[ProjectRecap] Retry failed for project ${projectId} user ${userId}:`, error);
        }
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;
    logger.info(`[ProjectRecap] Complete: ${successful} successful, ${failedCount} failed`);

    return { totalProjects: projectIds.length, successful, failed: failedCount, results };
  }

  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Generate per-user recaps for one project.
   *
   * Pass 1 runs once per channel (Redis-cached, shared across users).
   * Pass 2 runs once per subscriber, using only the channels that subscriber belongs to.
   */
  private async generateRecapForProject(
    projectId: string,
    targetDate: Date,
    subscriberIds: string[],
  ): Promise<ProjectRecapResult[]> {
    logger.info(`[ProjectRecap] Generating for project: ${projectId} (${subscriberIds.length} subscribers)`);

    const { startOfDay, endOfDay, dateStr } = getDateRangeInTimezone(targetDate);

    let project: { id: string; name: string } | null;
    let channels: { id: string; name: string }[];

    try {
      project = await db.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true },
      });
    } catch (error) {
      logger.error(`[ProjectRecap] Failed to fetch project ${projectId}:`, error);
      return subscriberIds.map((userId) => ({ projectId, userId, success: false, error: 'DB error fetching project' }));
    }

    if (!project) {
      logger.warn(`[ProjectRecap] Project not found: ${projectId} — skipping`);
      return subscriberIds.map((userId) => ({ projectId, userId, success: false, error: 'Project not found' }));
    }

    try {
      // Fetch all channels in the project that have at least one subscriber as a participant
      channels = await db.channel.findMany({
        where: {
          projectId,
          participants: { some: { userId: { in: subscriberIds } } },
        },
        select: { id: true, name: true },
      });
    } catch (error) {
      logger.error(`[ProjectRecap] Failed to fetch channels for project ${projectId}:`, error);
      return subscriberIds.map((userId) => ({ projectId, userId, success: false, error: 'DB error fetching channels' }));
    }

    if (channels.length === 0) {
      logger.info(`[ProjectRecap] No channels with subscribers found for project ${project.name}`);
      return subscriberIds.map((userId) => ({ projectId, userId, success: true }));
    }

    // Pass 1 — verbose per-channel summaries (cached in Redis, shared across users)
    const allChannelSummaries: ChannelVerboseSummary[] = [];
    for (const channel of channels) {
      const summary = await this.summarizeChannelVerbose(
        channel.id,
        channel.name,
        projectId,
        project.name,
        dateStr,
        startOfDay,
        endOfDay,
      );
      allChannelSummaries.push(summary);
    }

    // Pass 2 — per-user aggregation using only the channels the user is in
    const results: ProjectRecapResult[] = [];

    for (const userId of subscriberIds) {
      try {
        // Find channels this user is a participant of (from the already-fetched set)
        const userChannelIds = await db.channelParticipant.findMany({
          where: {
            userId,
            channelId: { in: channels.map((c) => c.id) },
          },
          select: { channelId: true },
        });
        const userChannelIdSet = new Set(userChannelIds.map((c) => c.channelId));

        const userChannelSummaries = allChannelSummaries.filter(
          (s) => userChannelIdSet.has(s.channelId),
        );

        const activeChannels = userChannelSummaries.filter((c) => c.hasActivity);
        if (activeChannels.length === 0) {
          results.push({ projectId, userId, success: true });
          continue;
        }

        const projectSummary = await this.aggregateIntoKeyPoints(project, activeChannels, dateStr);
        await this.persistRecap(projectId, userId, targetDate, projectSummary);
        results.push({ projectId, userId, success: true, summary: projectSummary });
      } catch (error) {
        logger.error(`[ProjectRecap] Failed for project ${projectId} user ${userId}:`, error);
        results.push({
          projectId,
          userId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Pass 1: verbose paragraph summarization of one channel → stored in Redis.
   * Not shown directly in the UI; feeds the aggregator.
   */
  private async summarizeChannelVerbose(
    channelId: string,
    channelName: string,
    projectId: string,
    projectName: string,
    dateStr: string,
    startOfDay: Date,
    endOfDay: Date,
  ): Promise<ChannelVerboseSummary> {
    const redisKey = `project-recap:channel:${channelId}:${dateStr}`;

    const cached = await redisService.get(redisKey);
    if (cached) {
      logger.info(`[ProjectRecap] Redis cache hit for channel ${channelName}`);
      return JSON.parse(cached) as ChannelVerboseSummary;
    }

    const conversations = await db.conversation.findMany({
      where: { channelId },
      select: { conversationId: true },
    });

    if (conversations.length === 0) {
      return { channelId, channelName, summary: '', messageCount: 0, hasActivity: false, conversationAnchors: [] };
    }

    const convoIds = conversations.map((c) => c.conversationId);
    const messages = await db.message.findMany({
      where: {
        conversationId: { in: convoIds },
        createdAt: { gte: startOfDay, lte: endOfDay },
        isDeleted: false,
      },
      include: { sender: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    if (messages.length === 0) {
      return { channelId, channelName, summary: '', messageCount: 0, hasActivity: false, conversationAnchors: [] };
    }

    // Collect the last message per conversation to use as anchors for citations
    const anchorsByConvo = new Map<string, ConversationAnchor>();
    for (const m of messages) {
      anchorsByConvo.set(m.conversationId, { conversationId: m.conversationId, messageId: m.messageId });
    }
    const conversationAnchors = [...anchorsByConvo.values()];

    const messagesText = messages
      .map((m) => {
        const author = m.sender?.name ?? m.sender?.email ?? 'Unknown';
        const time = m.createdAt.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
        });
        return `[${time}] ${author}: ${m.content}`;
      })
      .join('\n');

    const formattedDate = new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    try {
      const prompt = await getProjectRecapPrompt(PROMPT_NAMES.PROJECT_RECAP_CHANNEL_SUMMARY, {
        project_name: projectName,
        channel_name: channelName,
        date: formattedDate,
        message_count: String(messages.length),
        messages: messagesText,
      });

      const verboseSummary = await callLLM(
        prompt,
        'You are a thorough technical writer summarizing team communication for a daily recap. Write in flowing paragraphs.',
        projectId,
      );

      const result: ChannelVerboseSummary = {
        channelId,
        channelName,
        summary: verboseSummary,
        messageCount: messages.length,
        hasActivity: true,
        conversationAnchors,
      };

      await redisService.set(redisKey, JSON.stringify(result), REDIS_CHANNEL_SUMMARY_TTL);
      logger.info(`[ProjectRecap] Channel ${channelName} summarized and cached (${messages.length} msgs)`);
      return result;
    } catch (error) {
      logger.error(`[ProjectRecap] Channel summarization failed for ${channelName}:`, error);
      return {
        channelId,
        channelName,
        summary: '',
        messageCount: messages.length,
        hasActivity: true,
        conversationAnchors,
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Pass 2: meta-LLM call that reads the user's channel summaries and produces
   * exactly 10-12 key points with channel-level citations.
   */
  private async aggregateIntoKeyPoints(
    project: { id: string; name: string },
    channelSummaries: ChannelVerboseSummary[],
    dateStr: string,
  ): Promise<ProjectRecapSummary> {
    logger.info(
      `[ProjectRecap] Aggregating ${channelSummaries.length} channel summaries for project: ${project.name}`,
    );

    const citationsMap = channelSummaries
      .map((c, i) => `${i + 1}: { "channelId": "${c.channelId}", "channelName": "${c.channelName}" }`)
      .join('\n');

    const channelSummariesText = channelSummaries
      .map(
        (c, i) =>
          `=== Channel ${i + 1}: ${c.channelName} (${c.messageCount} messages) ===\n${c.summary || '(no summary available)'}`,
      )
      .join('\n\n');

    const formattedDate = new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const totalMessages = channelSummaries.reduce((sum, c) => sum + c.messageCount, 0);

    interface RawPoint {
      point: string;
      channelName: string;
      channelId: string;
      citationIndex: number;
    }
    interface ParsedOutput {
      overallSummary: string;
      highlights: RawPoint[];
      concerns: RawPoint[];
    }

    // Track anchor usage per channel to distribute citations evenly
    const anchorUsageCounter = new Map<string, number>();

    const toPoint = (p: RawPoint): ProjectRecapPoint => {
      const channel =
        channelSummaries.find((c) => c.channelId === p.channelId) ??
        channelSummaries.find((c) => c.channelName === p.channelName);
      const anchors = channel?.conversationAnchors ?? [];
      const citationIndex = p.citationIndex ?? 1;
      
      // Get current usage count for this channel and increment
      const channelKey = p.channelId || p.channelName || 'unknown';
      const currentUsage = anchorUsageCounter.get(channelKey) ?? 0;
      anchorUsageCounter.set(channelKey, currentUsage + 1);
      
      // Distribute citations: each key point picks a different conversation anchor
      // Use the usage counter to cycle through anchors for points from the same channel
      const anchor = anchors.length > 0 ? anchors[currentUsage % anchors.length] : undefined;
      return {
        point: p.point,
        channelId: p.channelId || channel?.channelId || '',
        channelName: p.channelName || 'General',
        citationIndex,
        conversationId: anchor?.conversationId,
        messageId: anchor?.messageId,
      };
    };

    try {
      const prompt = await getProjectRecapPrompt(PROMPT_NAMES.PROJECT_RECAP_AGGREGATOR, {
        project_name: project.name,
        date: formattedDate,
        channel_count: String(channelSummaries.length),
        channel_summaries: channelSummariesText,
        citations_map: citationsMap,
      });

      const output = await callLLM(
        prompt,
        'You are a project manager creating a concise daily recap. Respond with valid JSON only.',
        project.id,
      );

      let parsed: ParsedOutput;
      try {
        const match = output.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : output) as ParsedOutput;
      } catch {
        logger.error('[ProjectRecap] Failed to parse aggregator JSON — using fallback');
        parsed = {
          overallSummary: channelSummaries.map((c) => c.summary.slice(0, 150)).join(' '),
          highlights: channelSummaries.map((c, i) => ({
            point: c.summary.slice(0, 200) || `Activity in #${c.channelName}`,
            channelName: c.channelName,
            channelId: c.channelId,
            citationIndex: i + 1,
          })) as RawPoint[],
          concerns: [] as RawPoint[],
        };
      }

      return {
        projectName: project.name,
        projectId: project.id,
        summary: parsed.overallSummary || 'No summary available',
        good: (parsed.highlights ?? []).map(toPoint),
        bad: (parsed.concerns ?? []).map(toPoint),
        channelCount: channelSummaries.length,
        messageCount: totalMessages,
      };
    } catch (error) {
      logger.error('[ProjectRecap] Aggregation LLM call failed:', error);
      return {
        projectName: project.name,
        projectId: project.id,
        summary: `Activity across ${channelSummaries.length} channel${channelSummaries.length !== 1 ? 's' : ''}.`,
        good: channelSummaries.map((c, i) => ({
          point: c.summary.slice(0, 200) || `Activity in #${c.channelName}`,
          channelId: c.channelId,
          channelName: c.channelName,
          citationIndex: i + 1,
          conversationId: c.conversationAnchors[0]?.conversationId,
          messageId: c.conversationAnchors[0]?.messageId,
        })),
        bad: [],
        channelCount: channelSummaries.length,
        messageCount: totalMessages,
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────

  private async persistRecap(
    projectId: string,
    userId: string,
    recapDate: Date,
    summary: ProjectRecapSummary,
  ): Promise<void> {
    const dateStr = recapDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const normalizedDate = new Date(`${dateStr}T00:00:00Z`);

    // Use the upsert pattern without relying on the unique constraint name
    const existing = await db.recap.findFirst({
      where: { 
        entityType: 'PROJECT',
        entityId: projectId,
        userId,
        recapDate: normalizedDate
      }
    });
    
    if (existing) {
      await db.recap.update({
        where: { id: existing.id },
        data: { summary: JSON.stringify(summary) }
      });
    } else {
      await db.recap.create({
        data: { 
          entityType: 'PROJECT', 
          entityId: projectId, 
          userId, 
          recapDate: normalizedDate, 
          summary: JSON.stringify(summary) 
        }
      });
    }

    logger.info(`[ProjectRecap] Persisted for project ${projectId} user ${userId} on ${dateStr}`);
  }

  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get yesterday's project recaps for a user — only recaps generated for this specific user.
   */
  async getProjectRecapsForUser(
    userId: string,
    targetDate?: Date,
  ): Promise<ProjectRecapSummary[]> {
    const now = targetDate ?? new Date();
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const [year, month, day] = dateStr.split('-');
    const d = new Date(`${year}-${month}-${day}`);
    d.setDate(d.getDate() - 1);
    const recapDate = new Date(
      `${d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}T00:00:00Z`,
    );

    const recaps = await db.recap.findMany({
      where: { userId, recapDate, entityType: 'PROJECT' },
      select: { summary: true },
    });

    return recaps
      .map((r: { summary: string }) => {
        try {
          return JSON.parse(r.summary) as ProjectRecapSummary;
        } catch {
          return null;
        }
      })
      .filter((r): r is ProjectRecapSummary => r !== null);
  }

  async cleanupOldRecaps(retentionDays = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
    cutoff.setUTCHours(0, 0, 0, 0);

    const result = await db.recap.deleteMany({
      where: { recapDate: { lt: cutoff }, entityType: 'PROJECT' },
    });

    logger.info(
      `[ProjectRecap] Cleanup: deleted ${result.count} old recaps before ${cutoff.toISOString().split('T')[0]}`,
    );
    return result.count;
  }
}

export const projectRecapGenerationService = new ProjectRecapGenerationService();
