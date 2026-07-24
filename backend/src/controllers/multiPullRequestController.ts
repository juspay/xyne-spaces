import { Request, Response } from 'express';
import { MultiPullRequestService } from '../services/multiPullRequestService.js';
import { MultiBitbucketConfig, RepositoryConfig } from '../types/bitbucket.js';
import {logger} from '@/utils/logger';
import { config } from '@/config/env';

export class MultiPullRequestController {
  private multiPullRequestService: MultiPullRequestService;

  constructor() {
    // Define all repositories
    const repositories: RepositoryConfig[] = [
      { repositorySlug: 'euler-api-gateway', projectKey: 'EXC', displayName: 'Euler API Gateway' },
      { repositorySlug: 'euler-api-txns', projectKey: 'JBIZ', displayName: 'Euler API Transactions' },
      { repositorySlug: 'ardra-b2b', projectKey: 'JBIZ', displayName: 'Ardra B2B' },
      { repositorySlug: 'euler-lsp-api-gateway', projectKey: 'CREDIT', displayName: 'Euler LSP API Gateway' },
      { repositorySlug: 'euler-lsp', projectKey: 'CREDIT', displayName: 'Euler LSP' },
      { repositorySlug: 'newton-hs', projectKey: 'AX', displayName: 'Newton HS' },
      { repositorySlug: 'euler-api-pre-txn', projectKey: 'JBIZ', displayName: 'Euler API Pre Transaction' },
      { repositorySlug: 'offer-engine', projectKey: 'JBIZ', displayName: 'Offer Engine' },
      { repositorySlug: 'euler-api-order', projectKey: 'JBIZ', displayName: 'Euler API Order' },
      { repositorySlug: 'morpheus-hs', projectKey: 'DREAM', displayName: 'Morpheus HS' },
      { repositorySlug: 'pragati', projectKey: 'REC', displayName: 'Pragati' },
      { repositorySlug: 'euler-api-dashboard', projectKey: 'JBIZ', displayName: 'Euler API Dashboard' },
      { repositorySlug: 'euler-api-card', projectKey: 'JBIZ', displayName: 'Euler API Card' },
      { repositorySlug: 'euler-api-customer', projectKey: 'JBIZ', displayName: 'Euler API Customer' },
      { repositorySlug: 'euler-api-token', projectKey: 'JBIZ', displayName: 'Euler API Token' }
    ];

    // Initialize with configuration from environment variables
    const bitbucketConfig: MultiBitbucketConfig = {
      baseUrl: config.bitbucket.baseUrl,
      repositories: repositories,
      username: process.env.BITBUCKET_USERNAME || '',
      password: process.env.BITBUCKET_PASSWORD || '',
      token: process.env.BITBUCKET_TOKEN
    };

    this.multiPullRequestService = new MultiPullRequestService(bitbucketConfig);
  }


  /**
   * Get pull requests from all repositories
   * GET /api/analytics/multi-pull-requests?days=3
   */
  getAllPullRequests = async (req: Request, res: Response): Promise<void> => {
    try {
      const days = parseInt(req.query.days as string) || 3;

      if (days < 1 || days > 30) {
        res.status(400).json({
          success: false,
          error: 'Days parameter must be between 1 and 30',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const pullRequests = await this.multiPullRequestService.getAllPullRequestsFromLastDays(days);

      res.json({
        success: true,
        data: pullRequests,
        metadata: {
          count: pullRequests.length,
          days: days,
          repositories: [...new Set(pullRequests.map(pr => `${pr.projectKey}/${pr.repositorySlug}`))],
          dateRange: {
            from: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
            to: new Date().toISOString()
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching all pull requests:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch pull requests from all repositories',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  };


}
