import { MultiBitbucketService } from './multiBitbucketService.js';
import { PullRequestDbService } from './pullRequestDbService.js';
import { MultiBitbucketConfig, PullRequestDataWithRepo } from '../types/bitbucket.js';
import {logger} from '@/utils/logger';

export class MultiPullRequestService {
  private multiBitbucketService: MultiBitbucketService;
  private pullRequestDbService: PullRequestDbService;

  constructor(config: MultiBitbucketConfig) {
    this.multiBitbucketService = new MultiBitbucketService(config);
    this.pullRequestDbService = new PullRequestDbService();
  }


  /**
   * Get pull requests from all repositories for the last N days
   * Fetches from Bitbucket and saves to database
   */
  async getAllPullRequestsFromLastDays(days: number = 3): Promise<PullRequestDataWithRepo[]> {
    try {
      // Fetch fresh data from Bitbucket
      const pullRequests = await this.multiBitbucketService.getAllPullRequestsFromLastDays(days);

      // Save to database (upsert operation)
      if (pullRequests.length > 0) {
        const saveResult = await this.pullRequestDbService.savePullRequests(pullRequests);
        logger.info(`Database save result: ${saveResult.created} created, ${saveResult.updated} updated`);

        if (saveResult.errors.length > 0) {
          logger.warn('Some pull requests failed to save:', saveResult.errors);
        }
      }

      return pullRequests;
    } catch (error) {
      logger.error('Error in MultiPullRequestService.getAllPullRequestsFromLastDays:', error);
      throw new Error('Failed to fetch pull requests from multiple repositories');
    }
  }

}