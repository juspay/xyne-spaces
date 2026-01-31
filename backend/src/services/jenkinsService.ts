import axios, { AxiosInstance } from 'axios';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

interface JenkinsBuild {
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

interface JenkinsStage {
  id: string;
  name: string;
  status: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS' | 'NOT_EXECUTED' | 'ABORTED' | 'PAUSED_PENDING_INPUT';
  startTimeMillis: number;
  durationMillis: number;
  pauseDurationMillis: number;
}

interface JenkinsWfApiResponse {
  id: string;
  name: string;
  status: string;
  startTimeMillis: number;
  endTimeMillis: number;
  durationMillis: number;
  queueDurationMillis: number;
  pauseDurationMillis: number;
  stages: JenkinsStage[];
}

interface TriggerBuildResponse {
  success: boolean;
  message?: string;
  error?: string;
}

class JenkinsService {
  private client: AxiosInstance | null = null;
  private jobPath: string;
  private isConfigured: boolean = false;

  constructor() {
    this.jobPath = config.jenkins.jobPath;

    if (!config.jenkins.username || !config.jenkins.apiToken) {
      logger.warn(
        'Jenkins credentials not configured. Jenkins integration will be disabled. Set JENKINS_USERNAME and JENKINS_API_TOKEN environment variables to enable.',
      );
      return;
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    const authString = Buffer.from(
      `${config.jenkins.username}:${config.jenkins.apiToken}`,
    ).toString('base64');
    headers['Authorization'] = `Basic ${authString}`;

    this.client = axios.create({
      baseURL: config.jenkins.baseUrl,
      timeout: 30000,
      headers,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    this.isConfigured = true;
    logger.info('Jenkins service initialized successfully');
  }
  
  isAvailable(): boolean {
    return this.isConfigured && this.client !== null;
  }

  private async getCrumb(): Promise<{ crumb: string; crumbField: string } | null> {
    if (!this.client) return null;

    try {
      const response = await this.client.get('/crumbIssuer/api/json');
      return {
        crumb: response.data.crumb,
        crumbField: response.data.crumbRequestField,
      };
    } catch (error) {
      logger.warn('Failed to get Jenkins crumb (CSRF protection may be disabled):', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  async triggerBuild(
    branch: string,
    parameters?: Record<string, string>,
  ): Promise<TriggerBuildResponse> {
    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'Jenkins is not configured. Please set JENKINS_USERNAME and JENKINS_API_TOKEN environment variables.',
      };
    }

    if (!branch) {
      return { success: false, error: 'Branch is required' };
    }

    try {
      const crumbData = await this.getCrumb();
      const headers: Record<string, string> = {};

      if (crumbData) {
        headers[crumbData.crumbField] = crumbData.crumb;
      }

      let buildUrl = `${this.jobPath}/job/${encodeURIComponent(branch)}/buildWithParameters?delay=0`;

      if (parameters && Object.keys(parameters).length > 0) {
        const params = new URLSearchParams(parameters);
        buildUrl += '&' + params.toString();
      }

      const response = await this.client!.post(buildUrl, 'json={}', {
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      if (response.status >= 200 && response.status < 400) {
        return { success: true, message: 'Build triggered successfully' };
      }

      return { success: true };
    } catch (error) {
      logger.error('Error triggering Jenkins build:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getLatestBuild(branch: string): Promise<JenkinsBuild | null> {
    if (!this.isAvailable() || !branch) return null;

    try {
      const response = await this.client!.get(
        `${this.jobPath}/job/${encodeURIComponent(branch)}/lastBuild/api/json`,
      );
      return response.data;
    } catch (error) {
      logger.error('Error fetching latest Jenkins build:', {
        branch,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  async getBuildStages(buildNumber: number, branch: string): Promise<JenkinsStage[]> {
    if (!this.isAvailable() || !branch) return [];

    try {
      const response = await this.client!.get<JenkinsWfApiResponse>(
        `${this.jobPath}/job/${encodeURIComponent(branch)}/${buildNumber}/wfapi/describe`,
      );
      return response.data.stages || [];
    } catch (error) {
      logger.error('Error fetching Jenkins build stages:', {
        buildNumber,
        branch,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }
}

export const jenkinsService = new JenkinsService();
