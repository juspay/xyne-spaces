import { Router, Request, Response } from 'express';
import { bitbucketWebhookService } from "@/services/bitbucketWebhookService";
import { logger } from "@/utils/logger";

const router = Router();
export interface BitbucketWebhookEnvelope {
  eventKey: string; // derived from header: X-Event-Key
  receivedAt: string; // ISO timestamp (you add this)

  repository: BitbucketRepository;
  actor?: BitbucketActor;

  pullrequest?: BitbucketPullRequest;
  //ts-ignore
  push?: any; // event defined for limited type safety, can be expanded later
  //ts-ignore
  issue?: any;// event defined for limited type safety, can be expanded later
  commit_status?: BitbucketCommitStatus;

  // allow future Bitbucket additions
  raw?: unknown; //bitbucket may send or change fields anytime
}
export interface BitbucketRepository {
  uuid: string;
  name: string;
  full_name: string;
  is_private: boolean;

  project?: {
    key: string;
    name: string;
    uuid: string;
  };

  workspace?: {
    uuid: string;
    slug: string;
  };

  links?: {
    html?: { href: string };
  };
}
export interface BitbucketActor {
  uuid: string;
  display_name: string;
  nickname?: string;
  account_id?: string;
  email?: string;
  type: 'user' | 'team';
}
export interface BitbucketCommitStatus {
  state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'STOPPED';
  key: string;
  name: string;
  url?: string;
  description?: string;
}

/**
 * Bitbucket Cloud webhook pull request format
 * Used for webhook payloads from bitbucket.org
 */
export interface BitbucketPullRequest {
  id: number;
  title: string;
  description?: string;

  state: 'OPEN' | 'MERGED' | 'DECLINED';
  draft: boolean;

  comment_count: number;
  task_count?: number;

  created_on: string;
  updated_on: string;

  source: {
    branch: {
      name: string;
    };
    commit: {
      hash: string;
    };
  };

  destination: {
    branch: {
      name: string;
    };
  };

  merge_commit?: {
    hash: string;
  } | null;

  author?: BitbucketActor;

  links: {
    html: { href: string };
    commits?: { href: string };
    activity?: { href: string };
    merge?: { href: string };
    decline?: { href: string };
    statuses?: { href: string };
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

// Get bitbucket webhook via bitbot
router.post('/bitbucket', handleBitbucketWebhook);

export default router;
