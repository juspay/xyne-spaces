import { BitbucketService } from './bitbucketService.js';
import {
  MultiBitbucketConfig,
  RepositoryConfig,
  PullRequestDataWithRepo,
  BitbucketConfig
} from '../types/bitbucket.js';
import {logger} from '@/utils/logger';

export class MultiBitbucketService {
  private config: MultiBitbucketConfig;
  private services: Map<string, BitbucketService> = new Map();

  constructor(config: MultiBitbucketConfig) {
    this.config = config;
    this.initializeServices();
  }

  /**
   * Initialize BitbucketService instances for each repository
   */
  private initializeServices(): void {
    for (const repo of this.config.repositories) {
      const serviceConfig: BitbucketConfig = {
        baseUrl: this.config.baseUrl,
        projectKey: repo.projectKey,
        repositorySlug: repo.repositorySlug,
        username: this.config.username,
        password: this.config.password,
        token: this.config.token
      };

      const serviceKey = `${repo.projectKey}/${repo.repositorySlug}`;
      this.services.set(serviceKey, new BitbucketService(serviceConfig));
    }
  }

  /**
   * Get all configured repositories
   */
  getRepositories(): RepositoryConfig[] {
    return this.config.repositories;
  }

  /**
   * Get pull requests from all repositories for the last N days
   */
  async getAllPullRequestsFromLastDays(days: number = 3): Promise<PullRequestDataWithRepo[]> {
    const allPullRequests: PullRequestDataWithRepo[] = [];

    // Process all repositories in parallel
    const promises = this.config.repositories.map(async (repo) => {
      const serviceKey = `${repo.projectKey}/${repo.repositorySlug}`;
      const service = this.services.get(serviceKey);

      if (!service) {
        logger.error(`Service not found for ${serviceKey}`);
        return [];
      }

      try {
        const pullRequests = await service.getPullRequestsFromLastDays(days);

        // Add repository information to each PR
        return pullRequests.map(pr => ({
          ...pr,
          projectKey: repo.projectKey,
          repositorySlug: repo.repositorySlug,
          prUrl: `${pr.repositoryURL}/pull-requests/${pr.pr_id}`,
          displayName: repo.displayName || repo.repositorySlug
        }));
      } catch (error) {
        logger.error(`Error fetching PRs from ${serviceKey}:`, error);
        return [];
      }
    });

    const results = await Promise.allSettled(promises);

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allPullRequests.push(...result.value);
      } else {
        const repo = this.config.repositories[index];
        logger.error(`Failed to fetch PRs from ${repo.projectKey}/${repo.repositorySlug}:`, result.reason);
      }
    });

    // Sort by date (newest first)
    return allPullRequests.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  /**
   * Get pull requests from specific repositories
   */
  async getPullRequestsFromRepositories(
    repositoryKeys: string[], // Array of "projectKey/repositorySlug"
    days: number = 3
  ): Promise<PullRequestDataWithRepo[]> {
    const allPullRequests: PullRequestDataWithRepo[] = [];

    const promises = repositoryKeys.map(async (repoKey) => {
      const service = this.services.get(repoKey);
      const repo = this.config.repositories.find(r => `${r.projectKey}/${r.repositorySlug}` === repoKey);

      if (!service || !repo) {
        logger.error(`Service or repository config not found for ${repoKey}`);
        return [];
      }

      try {
        const pullRequests = await service.getPullRequestsFromLastDays(days);

        return pullRequests.map(pr => ({
          ...pr,
          projectKey: repo.projectKey,
          repositorySlug: repo.repositorySlug,
          prUrl: `${pr.repositoryURL}/pull-requests/${pr.pr_id}`,
          displayName: repo.displayName || repo.repositorySlug
        }));
      } catch (error) {
        logger.error(`Error fetching PRs from ${repoKey}:`, error);
        return [];
      }
    });

    const results = await Promise.allSettled(promises);

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        allPullRequests.push(...result.value);
      }
    });

    return allPullRequests.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  /**
   * Get pull requests grouped by repository
   */
  async getPullRequestsGroupedByRepository(days: number = 3): Promise<{
    [repoKey: string]: {
      repository: RepositoryConfig;
      pullRequests: PullRequestDataWithRepo[];
      stats: {
        total: number;
        byStatus: Record<string, number>;
        totalComments: number;
      };
    };
  }> {
    const grouped: { [repoKey: string]: any } = {};

    const promises = this.config.repositories.map(async (repo) => {
      const serviceKey = `${repo.projectKey}/${repo.repositorySlug}`;
      const service = this.services.get(serviceKey);

      if (!service) {
        return { repoKey: serviceKey, data: null };
      }

      try {
        const pullRequests = await service.getPullRequestsFromLastDays(days);

        const pullRequestsWithRepo = pullRequests.map(pr => ({
          ...pr,
          projectKey: repo.projectKey,
          repositorySlug: repo.repositorySlug,
          prUrl: `${pr.repositoryURL}/pull-requests/${pr.pr_id}`,
          displayName: repo.displayName || repo.repositorySlug
        }));

        // Calculate stats
        const stats = {
          total: pullRequestsWithRepo.length,
          byStatus: {} as Record<string, number>,
          totalComments: 0
        };

        pullRequestsWithRepo.forEach(pr => {
          stats.byStatus[pr.status] = (stats.byStatus[pr.status] || 0) + 1;
          stats.totalComments += pr.numberOfComments;
        });

        return {
          repoKey: serviceKey,
          data: {
            repository: repo,
            pullRequests: pullRequestsWithRepo,
            stats
          }
        };
      } catch (error) {
        logger.error(`Error fetching PRs from ${serviceKey}:`, error);
        return { repoKey: serviceKey, data: null };
      }
    });

    const results = await Promise.allSettled(promises);

    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.data) {
        grouped[result.value.repoKey] = result.value.data;
      }
    });

    return grouped;
  }

  /**
   * Get aggregated stats across all repositories
   */
  async getAggregatedStats(days: number = 3): Promise<{
    totalRepositories: number;
    totalPullRequests: number;
    totalComments: number;
    byStatus: Record<string, number>;
    byRepository: Record<string, number>;
    averageCommentsPerPR: number;
  }> {
    const allPullRequests = await this.getAllPullRequestsFromLastDays(days);

    const stats = {
      totalRepositories: this.config.repositories.length,
      totalPullRequests: allPullRequests.length,
      totalComments: 0,
      byStatus: {} as Record<string, number>,
      byRepository: {} as Record<string, number>,
      averageCommentsPerPR: 0
    };

    allPullRequests.forEach(pr => {
      stats.totalComments += pr.numberOfComments;
      stats.byStatus[pr.status] = (stats.byStatus[pr.status] || 0) + 1;

      const repoKey = `${pr.projectKey}/${pr.repositorySlug}`;
      stats.byRepository[repoKey] = (stats.byRepository[repoKey] || 0) + 1;
    });

    stats.averageCommentsPerPR = stats.totalPullRequests > 0 ?
      stats.totalComments / stats.totalPullRequests : 0;

    return stats;
  }
}
