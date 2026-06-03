import axios from 'axios';
import { config as appConfig } from '@/config/env';
import { logger } from '@/utils/logger';

export interface MettleTeamMembersResponse {
  active_employee_count?: number;
  description?: string | null;
  employee_list?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

class MettleTeamMembersService {
  private baseUrl: string;
  private token: string;

  constructor() {
    this.baseUrl = appConfig.mettleApiBaseUrl;
    this.token = appConfig.mettleToken;
  }

  async fetchTeamMembersFromMettle(teamId: string): Promise<MettleTeamMembersResponse> {
    if (!this.token) {
      throw new Error('Mettle API token is not set in config');
    }

    if (!this.baseUrl) {
      throw new Error('Mettle API base URL is not set in config');
    }

    const normalizedTeamId = teamId.trim();
    if (!normalizedTeamId) {
      throw new Error('teamId is required');
    }

    const url = `${this.baseUrl}/api/external/team/members?teamId=${encodeURIComponent(normalizedTeamId)}`;

    try {
      logger.info('[MettleTeamMembers] Fetching team members from Mettle', {
        teamId: normalizedTeamId,
        url,
      });

      const response = await axios.get<MettleTeamMembersResponse>(url, {
        headers: {
          mettleToken: this.token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 10000,
      });

      logger.info('[MettleTeamMembers] Successfully fetched team members from Mettle', {
        teamId: normalizedTeamId,
        employeeCount: response.data.active_employee_count ?? response.data.employee_list?.length ?? 0,
      });

      return response.data;
    } catch (error) {
      logger.error('[MettleTeamMembers] Failed to fetch team members from Mettle', {
        teamId: normalizedTeamId,
        error,
      });
      throw error;
    }
  }
}

export const mettleTeamMembersService = new MettleTeamMembersService();
