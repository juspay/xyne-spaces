import axios from 'axios';
import { config as appConfig } from '@/config/env';
import { logger } from '@/utils/logger';

export type MettleTeamGoalTrack = '2X' | '5X' | '10X' | string;

export interface MettleTeamGoal {
  id: string;
  team_id?: string;
  teamId?: string;
  subteam_id?: string | null;
  subteamId?: string | null;
  title: string;
  description?: string | null;
  status?: string | null;
  track?: MettleTeamGoalTrack | null;
  visibility?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

class MettleTeamGoalsService {
  private baseUrl: string;
  private token: string;

  constructor() {
    this.baseUrl = appConfig.mettleApiBaseUrl;
    this.token = appConfig.mettleToken;
  }

  async fetchActiveTeamGoals(
    teamId: string,
    options: { throwOnError?: boolean } = {}
  ): Promise<MettleTeamGoal[]> {
    if (!this.token) {
      logger.warn('[MettleTeamGoals] Mettle API token is not set; returning no goals', {
        teamId,
      });
      return [];
    }

    if (!this.baseUrl) {
      logger.warn('[MettleTeamGoals] Mettle API base URL is not set; returning no goals', {
        teamId,
      });
      return [];
    }

    const normalizedTeamId = teamId.trim();
    if (!normalizedTeamId) {
      return [];
    }

    const url = `${this.baseUrl}/api/external/team/goals`;

    try {
      logger.info('[MettleTeamGoals] Fetching active team goals from Mettle', {
        teamId: normalizedTeamId,
        url,
      });

      const response = await axios.get<unknown>(url, {
        headers: {
          mettleToken: this.token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        params: {
          teamId: normalizedTeamId,
          view: 'ACTIVE',
        },
        timeout: 10000,
      });

      const goals = Array.isArray(response.data)
        ? response.data
        : Array.isArray((response.data as { goals?: unknown[] } | null)?.goals)
          ? (response.data as { goals: unknown[] }).goals
          : [];

      const normalizedGoals = goals
        .filter((goal): goal is Record<string, unknown> => {
          return Boolean(goal) && typeof goal === 'object' && !Array.isArray(goal);
        })
        .map((goal) => ({
          ...goal,
          id: typeof goal.id === 'string' ? goal.id : String(goal.id ?? ''),
          title: typeof goal.title === 'string' ? goal.title : String(goal.title ?? ''),
        }))
        .filter((goal): goal is MettleTeamGoal => Boolean(goal.id && goal.title));

      logger.info('[MettleTeamGoals] Successfully fetched active team goals from Mettle', {
        teamId: normalizedTeamId,
        goalCount: normalizedGoals.length,
      });

      return normalizedGoals;
    } catch (error) {
      logger.warn('[MettleTeamGoals] Failed to fetch active team goals; returning no goals', {
        teamId: normalizedTeamId,
        error,
      });
      if (options.throwOnError) throw error;
      return [];
    }
  }
}

export const mettleTeamGoalsService = new MettleTeamGoalsService();
