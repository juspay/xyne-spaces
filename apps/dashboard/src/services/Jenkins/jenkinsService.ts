import { apiInstance } from '../clients/apiClient';

export interface JenkinsBuild {
  id: string;
  number: number;
  url: string;
  result: string | null;
  building: boolean;
  duration: number;
  estimatedDuration: number;
  timestamp: number;
  displayName: string;
  description: string | null;
}

export interface JenkinsStage {
  id: string;
  name: string;
  status:
    | 'SUCCESS'
    | 'FAILED'
    | 'IN_PROGRESS'
    | 'NOT_EXECUTED'
    | 'ABORTED'
    | 'PAUSED_PENDING_INPUT';
  startTimeMillis: number;
  durationMillis: number;
  pauseDurationMillis: number;
}

interface TriggerBuildResponse {
  success: boolean;
  message?: string;
  error?: string;
}

interface BuildResponse {
  success: boolean;
  build?: JenkinsBuild;
  error?: string;
}

interface StagesResponse {
  success: boolean;
  stages: JenkinsStage[];
  count: number;
  error?: string;
}

export const jenkinsService = {
  async triggerBuild(
    branch: string,
    parameters?: Record<string, string>,
  ): Promise<TriggerBuildResponse> {
    try {
      const response = await apiInstance.post<TriggerBuildResponse>('/jenkins/trigger', {
        branch,
        parameters,
      });
      return response.data;
    } catch {
      return {
        success: false,
        error: 'Failed to trigger build',
      };
    }
  },

  async getLatestBuild(branch?: string): Promise<BuildResponse> {
    try {
      const params = new URLSearchParams();
      if (branch) params.append('branch', branch);

      const response = await apiInstance.get<BuildResponse>(
        `/jenkins/builds/latest?${params.toString()}`,
      );
      return response.data;
    } catch {
      return {
        success: false,
        error: 'Failed to get latest build',
      };
    }
  },

  async getBuildStages(buildNumber: number, branch?: string): Promise<StagesResponse> {
    try {
      const params = new URLSearchParams();
      if (branch) params.append('branch', branch);

      const response = await apiInstance.get<StagesResponse>(
        `/jenkins/builds/${buildNumber}/stages?${params.toString()}`,
      );
      return response.data;
    } catch {
      return {
        success: false,
        stages: [],
        count: 0,
        error: 'Failed to get build stages',
      };
    }
  },
};
