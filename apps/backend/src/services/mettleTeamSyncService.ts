import axios from 'axios';
import { config as appConfig } from '@/config/env';
import { logger } from '@/utils/logger';

export interface MettleTeam {
  id: string;
  name: string;
  description: string;
  owner_id: string | null;
}

export interface MettleTeamsResponse {
  teams: MettleTeam[];
}

export const normalizeMettleTeamsResponse = (payload: unknown): MettleTeam[] => {
  if (Array.isArray(payload)) return payload as MettleTeam[];
  if (!payload || typeof payload !== 'object') return [];

  const record = payload as { teams?: unknown; data?: unknown };
  if (Array.isArray(record.teams)) return record.teams as MettleTeam[];
  if (Array.isArray(record.data)) return record.data as MettleTeam[];
  if (record.data && typeof record.data === 'object') {
    const nestedTeams = (record.data as { teams?: unknown }).teams;
    if (Array.isArray(nestedTeams)) return nestedTeams as MettleTeam[];
  }
  return [];
};

class MettleTeamSyncService {
  private baseUrl: string;
  private token: string;

  constructor() {
    this.baseUrl = appConfig.mettleApiBaseUrl;
    this.token = appConfig.mettleToken;
  }

  async fetchTeamsFromMettle(): Promise<MettleTeamsResponse> {
    try {
      if (!this.token) {
        throw new Error('Mettle API token is not set in config');
      }

      const url = `${this.baseUrl}/api/external/team/list`;
      const response = await axios.get<unknown>(url, {
        headers: {
          mettleToken: this.token,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      const teams = normalizeMettleTeamsResponse(response.data);
      logger.info('[MettleTeamSync] Successfully fetched teams from Mettle', {
        teamCount: teams.length,
      });

      return { teams };
    } catch (error) {
      logger.error('[MettleTeamSync] Failed to fetch teams from Mettle', {
        error,
        baseUrl: this.baseUrl,
      });
      throw error;
    }
  }
}

export const mettleTeamSyncService = new MettleTeamSyncService();
