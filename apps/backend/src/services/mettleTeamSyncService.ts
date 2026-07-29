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
      const response = await axios.get<MettleTeamsResponse>(url, {
        headers: {
          mettleToken: this.token,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      logger.info('[MettleTeamSync] Successfully fetched teams from Mettle', {
        teamCount: response.data.teams?.length || 0,
      });

      return response.data;
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
