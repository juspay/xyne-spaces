import { Router, Request, Response} from 'express';
import { bitbucketWebhookService } from "@/services/bitbucketWebhookService";
import { bitbucketWebhookMiddleware } from "@/middleware/bitbucketWebhookValidator";
import { jenkinsWebhookMiddleware } from "@/middleware/jenkinsWebhookValidator";
import { githubWebhookService } from "@/services/githubWebhookService";
import { githubWebhookMiddleware } from "@/middleware/githubWebhookValidator";
import { logger } from "@/utils/logger";
import { handleJenkinsWebhook } from '@/bots/implementations/qa-alert-bot/qa-alert-bot';

const router = Router();

/**
 * Bitbucket Server webhook envelope structure
 * Based on Bitbucket Server 8.6 documentation
 */
export interface BitbucketWebhookEnvelope {
  eventKey: string; // derived from header: X-Event-Key (e.g., pr:opened, pr:merged)
  date: string; // ISO timestamp from server
  receivedAt: string; // ISO timestamp (we add this)

  repository?: BitbucketRepository;
  actor?: BitbucketUser;

  pullRequest?: BitbucketPullRequest;
  
  // pr:modified specific fields
  previousTitle?: string;
  previousDescription?: string;
  previousTarget?: {
    id: string;
    displayId: string;
    type: string;
    latestCommit: string;
    latestChangeset: string;
  };
  
  // Other event types
  changes?: any[]; // for repo:refs_changed events
  comment?: any; // for comment events
  
  // allow future Bitbucket Server additions
  [key: string]: any;
}

/**
 * Bitbucket Server repository structure
 */
export interface BitbucketRepository {
  slug: string;
  id: number;
  name: string;
  scmId: string;
  state: string;
  statusMessage: string;
  forkable: boolean;
  
  project: {
    key: string;
    id: number;
    name: string;
    public: boolean;
    type: string; // 'NORMAL' or 'PERSONAL'
    owner?: BitbucketUser; // Present when type is PERSONAL
  };
  
  public: boolean;
  
  links?: {
    clone?: Array<{ href: string; name: string }>;
    self?: Array<{ href: string }>;
  };
}

/**
 * Bitbucket Server user/actor structure
 */
export interface BitbucketUser {
  name: string;
  emailAddress: string;
  id: number;
  displayName: string;
  active: boolean;
  slug: string;
  type: string;
  
  links?: {
    self?: Array<{ href: string }>;
  };
}

/**
 * Bitbucket Server pull request structure
 * Used for webhook payloads from Bitbucket Server/Data Center
 */
export interface BitbucketPullRequest {
  id: number;
  version: number;
  title: string;
  description?: string;

  state: 'OPEN' | 'MERGED' | 'DECLINED';
  open: boolean;
  closed: boolean;

  createdDate: number; // Unix timestamp in milliseconds
  updatedDate: number;
  closedDate?: number;

  fromRef: {
    id: string; // e.g., "refs/heads/feature-branch"
    displayId: string; // e.g., "feature-branch"
    latestCommit: string;
    repository: BitbucketRepository;
  };

  toRef: {
    id: string;
    displayId: string;
    latestCommit: string;
    repository: BitbucketRepository;
  };

  locked: boolean;

  author: {
    user: BitbucketUser;
    role: string;
    approved: boolean;
    status: string;
  };

  reviewers: Array<{
    user: BitbucketUser;
    lastReviewedCommit?: string;
    role: string;
    approved: boolean;
    status: string;
  }>;

  participants: Array<{
    user: BitbucketUser;
    role: string;
    approved: boolean;
    status: string;
  }>;

  properties?: {
    mergeCommit?: {
      displayId: string;
      id: string;
    };
    commentCount?: number;
  };

  links: {
    self: Array<{ href: string } | null>;
  };
}

async function handleBitbucketWebhook(req: Request, res: Response): Promise<void> {
    try {
        const payload: BitbucketWebhookEnvelope = req.body;
        if (!payload) {
            res.status(400).json({
                success: false,
                error: 'No data provided'
            });
            return;
        }

        // Require X-Event-Key header
        const eventKey = req.headers['x-event-key'] as string;
        if (!eventKey) {
            logger.warn('[Bitbucket-Webhook] Missing X-Event-Key header');
            res.status(400).json({ success: false, error: 'Missing X-Event-Key' });
            return;
        }

        payload.eventKey = eventKey;
        payload.receivedAt = new Date().toISOString();

        const result = await bitbucketWebhookService.handleWebhookEvent(eventKey, payload);
        res.status(200).json(result);
    } catch (error) {
        logger.error('[Bitbucket-Webhook] Error:', error);
        res.status(200).json({ success: true, message: 'Acknowledged' });
    }
}


router.post('/bitbucket', bitbucketWebhookMiddleware.verify, handleBitbucketWebhook);

async function handleGitHubWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body;
    if (!payload) {
      res.status(400).json({
        success: false,
        error: 'No data provided',
      });
      return;
    }

    const eventType = req.headers['x-github-event'] as string;
    if (!eventType) {
      logger.warn('[GitHub-Webhook] Missing X-GitHub-Event header');
      res.status(400).json({ success: false, error: 'Missing X-GitHub-Event' });
      return;
    }

    const result = await githubWebhookService.handleWebhookEvent(eventType, payload);
    res.status(200).json(result);
  } catch (error) {
    logger.error('[GitHub-Webhook] Error:', error);
    res.status(200).json({ success: true, message: 'Acknowledged' });
  }
}

router.post('/github', githubWebhookMiddleware.verify, handleGitHubWebhook);

// Use raw body parser for Jenkins webhook to preserve exact bytes for HMAC verification
router.post('/qa-alerts', 
   
  jenkinsWebhookMiddleware.verify, 
  handleJenkinsWebhook
);

export default router;
