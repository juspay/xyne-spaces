import { LLMClient, createUserMessage } from '@framework';
import { config as appConfig } from '@/config/env';
import {
  TeamChannelRecapChannelCandidate,
  teamIntelligenceTeamRepository,
} from '@/database/repositories/teamIntelligenceTeamRepository';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { createTeamIntelligenceLlmClient } from '@/team-intelligence/services/team-intelligence-llm-client';

export interface TeamBulletsDateRangeInput {
  from: Date;
  to: Date;
  teamId: string;
  orgId?: string | null;
  page: number;
  limit: number;
}

class TeamIntelligenceTeamDashboardService {
  private async getDefaultWorkspaceLlmClient(): Promise<LLMClient | null> {
    return createTeamIntelligenceLlmClient();
  }

  async getTeamBullets(input: TeamBulletsDateRangeInput) {
    try {
      return await teamIntelligenceTeamRepository.getTeamBulletsByDate({
        from: input.from,
        to: input.to,
        teamId: input.teamId,
        orgId: input.orgId,
        page: input.page,
        limit: input.limit,
      });
    } catch (error) {
      logger.error('[TeamIntelligenceTeam] getTeamBullets failed', { error, input });
      throw error;
    }
  }

  async getTeamLeadershipSnapshots(input: { from: Date; to: Date; teamId: string; orgId?: string | null }) {
    try {
      return await teamIntelligenceTeamRepository.getTeamLeadershipSnapshotsByDate(input);
    } catch (error) {
      logger.error('[TeamIntelligenceTeam] getTeamLeadershipSnapshots failed', { error, input });
      throw error;
    }
  }

  async getPrByDate(input: { from: Date; to: Date; prId: number; orgId?: string | null }) {
    try {
      return await teamIntelligenceTeamRepository.getPrByDate({
        from: input.from,
        to: input.to,
        prId: input.prId,
        orgId: input.orgId,
      });
    } catch (error) {
      logger.error('[TeamIntelligenceTeam] getPrByDate failed', { error, input });
      throw error;
    }
  }

  async getTeamUsageSummary(input: { from: Date; to: Date; teamId: string; orgId?: string | null }) {
    try {
      return await teamIntelligenceTeamRepository.getTeamUsageSummary({
        from: input.from,
        to: input.to,
        teamId: input.teamId,
        orgId: input.orgId,
      });
    } catch (error) {
      logger.error('[TeamIntelligenceTeam] getTeamUsageSummary failed', { error, input });
      throw error;
    }
  }

  private normalizeTeamName(teamName: string): string {
    return teamName.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private buildTeamChannelMatchCacheKey(teamId: string, from: Date, to: Date): string {
    const fromDate = from.toISOString().slice(0, 10);
    const toDate = to.toISOString().slice(0, 10);
    return `team-intelligence:team-channel-match:v2:${encodeURIComponent(teamId)}:${fromDate}:${toDate}`;
  }

  private fallbackMatchChannelIds(teamName: string, candidates: TeamChannelRecapChannelCandidate[]): string[] {
    const teamTokens = this
      .normalizeTeamName(teamName)
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);

    if (teamTokens.length === 0) {
      return candidates.slice(0, 5).map((candidate) => candidate.channelId);
    }

    const scored = candidates
      .map((candidate) => {
        const normalizedChannel = candidate.channelName.toLowerCase();
        const tokenHits = teamTokens.filter((token) => normalizedChannel.includes(token)).length;
        const score = tokenHits / teamTokens.length;
        return {
          channelId: candidate.channelId,
          score,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((entry) => entry.channelId);

    return scored.length > 0 ? scored : candidates.slice(0, 5).map((candidate) => candidate.channelId);
  }

  private async llmMatchChannelIds(teamNames: string[], candidates: TeamChannelRecapChannelCandidate[]): Promise<string[]> {
    if (candidates.length === 0) {
      return [];
    }

    try {
      const llmClient = await this.getDefaultWorkspaceLlmClient();
      if (!llmClient) {
        return [];
      }

      const candidateJson = JSON.stringify(
        candidates.map((candidate) => ({
          channelId: candidate.channelId,
          channelName: candidate.channelName,
          recapCount: candidate.recapCount,
        }))
      );

      const teamNamesLine = teamNames.length === 1
        ? `Team name: ${teamNames[0]}`
        : `Team names (all known names for this team, including past names): ${teamNames.join(', ')}`;

      const prompt = [
        'You are matching a team to related channel names.',
        teamNamesLine,
        'Candidate channels (JSON array):',
        candidateJson,
        'Return ONLY valid JSON in this shape: {"matchedChannelIds": ["id1", "id2"]}.',
        'Include all likely matches, ordered from most likely to least likely.',
        'Do not include channel IDs that are not present in the candidate list.',
      ].join('\n');

      const response = await llmClient.generate({
        model: appConfig.workflow.defaultModelName,
        messages: [createUserMessage(prompt)],
        parameters: { maxTokens: 1024 },
      });

      const raw = response.content?.trim();
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as { matchedChannelIds?: unknown };
      const allowedIds = new Set(candidates.map((candidate) => candidate.channelId));
      const matchedIds = Array.isArray(parsed.matchedChannelIds)
        ? parsed.matchedChannelIds
            .filter((value): value is string => typeof value === 'string')
            .filter((id) => allowedIds.has(id))
        : [];

      return [...new Set(matchedIds)];
    } catch (error) {
      logger.warn('[TEAM-INTEL-TEAM] LLM team-channel matching failed', { error, teamNames });
      return [];
    }
  }

  async getTeamChannelRecaps(input: { from: Date; to: Date; teamId: string; page: number; limit: number; workspaceId: string }) {
    try {
      const { from, to, teamId, page, limit, workspaceId } = input;
      const display = await teamIntelligenceTeamRepository.findLatestTeamDisplayByTeamId(teamId, { from, to });
      const teamName = display?.teamName ?? 'No Team';
      const allTeamNames = await teamIntelligenceTeamRepository.findAllTeamNamesByTeamId(teamId);
      const teamNamesForMatching = allTeamNames.length > 0 ? allTeamNames : [teamName];
      const cacheKey = this.buildTeamChannelMatchCacheKey(teamId, from, to);
      const cacheTtlSeconds = 5 * 24 * 60 * 60;

      const candidates = await teamIntelligenceTeamRepository.getChannelRecapChannelsByDate({ from, to, workspaceId });
    if (candidates.length === 0) {
      return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        teamId,
        teamName,
        page,
        limit,
        cache: {
          hit: false,
          key: cacheKey,
          ttlSeconds: cacheTtlSeconds,
        },
        matchedChannels: [],
        totalMatchedChannels: 0,
        total: 0,
        totalPages: 0,
        recaps: [],
        ticketMetrics: {
          totalCount: 0,
          solvedCount: 0,
          todoCount: 0,
          startedCount: 0,
          pausedCount: 0,
          cancelledCount: 0,
          overdueCount: 0,
        },
        overdueTickets: [],
      };
    }

    let matchedChannelIds: string[] = [];
    let cacheHit = false;

    // Try to read from cache, but gracefully degrade on Redis failure
    try {
      const cachedRaw = await redisService.get(cacheKey);
      if (cachedRaw) {
        try {
          const cachedParsed = JSON.parse(cachedRaw) as {
            matchedChannelIds?: unknown;
            matchedChannels?: unknown;
          };
          const allowedIds = new Set(candidates.map((candidate) => candidate.channelId));
          matchedChannelIds = Array.isArray(cachedParsed.matchedChannelIds)
            ? cachedParsed.matchedChannelIds
                .filter((value): value is string => typeof value === 'string')
                .filter((id) => allowedIds.has(id))
            : [];
          cacheHit = matchedChannelIds.length > 0;
        } catch (parseError) {
          logger.warn('[TEAM-INTEL-TEAM] Redis cache key parse failed', { cacheKey, parseError });
          cacheHit = false;
        }
      }
    } catch (redisGetError) {
      logger.warn('[TEAM-INTEL-TEAM] Redis cache read failed, proceeding without cache', { redisGetError });
      cacheHit = false;
    }

    if (!cacheHit) {
      matchedChannelIds = await this.llmMatchChannelIds(teamNamesForMatching, candidates);
      if (matchedChannelIds.length === 0) {
        matchedChannelIds = this.fallbackMatchChannelIds(teamName, candidates);
      }

      // Try to write to cache, but don't fail if Redis is down
      try {
        await redisService.set(
          cacheKey,
          JSON.stringify({
            matchedChannelIds,
            matchedChannels: candidates
              .filter((candidate) => matchedChannelIds.includes(candidate.channelId))
              .map((candidate) => ({ channelId: candidate.channelId, channelName: candidate.channelName })),
            teamId,
            teamName: this.normalizeTeamName(teamName),
          }),
          cacheTtlSeconds
        );
      } catch (redisSetError) {
        logger.warn('[TEAM-INTEL-TEAM] Redis cache write failed, continuing without cache', { redisSetError, cacheKey });
        // Don't throw; endpoint still works without caching
      }
    }

    const recapResult = await teamIntelligenceTeamRepository.getChannelRecapsByChannelIdsAndDate({
      from,
      to,
      channelIds: matchedChannelIds,
      page,
      limit,
      workspaceId,
    });

    const matchedChannelSet = new Set(matchedChannelIds);
    const matchedChannels = candidates.filter((candidate) => matchedChannelSet.has(candidate.channelId));
    const orderMap = new Map(matchedChannelIds.map((id, index) => [id, index]));
    matchedChannels.sort((a, b) => (orderMap.get(a.channelId) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.channelId) ?? Number.MAX_SAFE_INTEGER));

    return {
      from: recapResult.from,
      to: recapResult.to,
      teamId,
      teamName,
      page,
      limit,
      cache: {
        hit: cacheHit,
        key: cacheKey,
        ttlSeconds: cacheTtlSeconds,
      },
      matchedChannels,
      totalMatchedChannels: matchedChannels.length,
      total: recapResult.total,
      totalPages: recapResult.totalPages,
      recaps: recapResult.recaps,
    };
    } catch (error) {
      logger.error('[TeamIntelligenceTeam] getTeamChannelTickets failed', { error, input });
      throw error;
    }
  }

  async getTeamChannelTickets(input: { from: Date; to: Date; teamId: string; page: number; limit: number; workspaceId: string }) {
    try {
      const { from, to, teamId, page, limit, workspaceId } = input;
      const display = await teamIntelligenceTeamRepository.findLatestTeamDisplayByTeamId(teamId, { from, to });
      const teamName = display?.teamName ?? 'No Team';
      const allTeamNames = await teamIntelligenceTeamRepository.findAllTeamNamesByTeamId(teamId);
      const teamNamesForMatching = allTeamNames.length > 0 ? allTeamNames : [teamName];
      const cacheKey = this.buildTeamChannelMatchCacheKey(teamId, from, to);
      const cacheTtlSeconds = 5 * 24 * 60 * 60;

      const candidates = await teamIntelligenceTeamRepository.getChannelRecapChannelsByDate({ from, to, workspaceId });
      if (candidates.length === 0) {
        return {
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
          teamId,
          teamName,
          page,
          limit,
          cache: {
            hit: false,
            key: cacheKey,
            ttlSeconds: cacheTtlSeconds,
          },
          matchedChannels: [],
          totalMatchedChannels: 0,
          total: 0,
          totalPages: 0,
          tickets: [],
          ticketMetrics: {
            totalCount: 0,
            solvedCount: 0,
            todoCount: 0,
            startedCount: 0,
            pausedCount: 0,
            cancelledCount: 0,
            overdueCount: 0,
          },
        };
      }

      let matchedChannelIds: string[] = [];
      let cacheHit = false;

      try {
        const cachedRaw = await redisService.get(cacheKey);
        if (cachedRaw) {
          try {
            const cachedParsed = JSON.parse(cachedRaw) as {
              matchedChannelIds?: unknown;
              matchedChannels?: unknown;
            };
            const allowedIds = new Set(candidates.map((candidate) => candidate.channelId));
            matchedChannelIds = Array.isArray(cachedParsed.matchedChannelIds)
              ? cachedParsed.matchedChannelIds
                  .filter((value): value is string => typeof value === 'string')
                  .filter((id) => allowedIds.has(id))
              : [];
            cacheHit = matchedChannelIds.length > 0;
          } catch (parseError) {
            logger.warn('[TEAM-INTEL-TEAM] Redis cache key parse failed', { cacheKey, parseError });
            cacheHit = false;
          }
        }
      } catch (redisGetError) {
        logger.warn('[TEAM-INTEL-TEAM] Redis cache read failed, proceeding without cache', { redisGetError });
        cacheHit = false;
      }

      if (!cacheHit) {
        matchedChannelIds = await this.llmMatchChannelIds(teamNamesForMatching, candidates);
        if (matchedChannelIds.length === 0) {
          matchedChannelIds = this.fallbackMatchChannelIds(teamName, candidates);
        }

        try {
          await redisService.set(
            cacheKey,
            JSON.stringify({
              matchedChannelIds,
              matchedChannels: candidates
                .filter((candidate) => matchedChannelIds.includes(candidate.channelId))
                .map((candidate) => ({ channelId: candidate.channelId, channelName: candidate.channelName })),
              teamId,
              teamName: this.normalizeTeamName(teamName),
            }),
            cacheTtlSeconds
          );
        } catch (redisSetError) {
          logger.warn('[TEAM-INTEL-TEAM] Redis cache write failed, continuing without cache', { redisSetError, cacheKey });
        }
      }

      const ticketsResult = await teamIntelligenceTeamRepository.getChannelTicketsByChannelIdsAndDate({
        from,
        to,
        channelIds: matchedChannelIds,
        page,
        limit,
      });

      const matchedChannelSet = new Set(matchedChannelIds);
      const matchedChannels = candidates.filter((candidate) => matchedChannelSet.has(candidate.channelId));
      const orderMap = new Map(matchedChannelIds.map((id, index) => [id, index]));
      matchedChannels.sort((a, b) => (orderMap.get(a.channelId) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.channelId) ?? Number.MAX_SAFE_INTEGER));

      return {
        from: ticketsResult.from,
        to: ticketsResult.to,
        teamId,
        teamName,
        page,
        limit,
        cache: {
          hit: cacheHit,
          key: cacheKey,
          ttlSeconds: cacheTtlSeconds,
        },
        matchedChannels,
        totalMatchedChannels: matchedChannels.length,
        total: ticketsResult.total,
        totalPages: ticketsResult.totalPages,
        tickets: ticketsResult.tickets,
        ticketMetrics: ticketsResult.ticketMetrics,
      };
    } catch (error) {
      logger.error('[TeamIntelligenceTeam] getTeamChannelRecaps failed', { error, input });
      throw error;
    }
  }
}

export const teamIntelligenceTeamDashboardService = new TeamIntelligenceTeamDashboardService();
