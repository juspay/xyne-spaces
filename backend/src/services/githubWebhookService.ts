import { logger } from '@/utils/logger';
import { xyneCommentService } from '@/services/xyneCommentService';

interface GitHubUser {
  login: string;
  email?: string;
}

interface GitHubRepository {
  name: string;
  owner: GitHubUser;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
}

interface GitHubIssue {
  number: number;
  pull_request?: {
    html_url: string;
  };
}

interface GitHubPRReviewCommentPayload {
  action: 'created' | 'edited' | 'deleted';
  comment: {
    body: string;
    user: GitHubUser;
  };
  issue?: GitHubIssue;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
}

const XYNE_MENTION_EMAIL = 'john.doe@gmail.com';
const XYNE_MENTION_USERNAME = 'xynespaces';

export class GitHubWebhookService {
  async handleWebhookEvent(
    eventType: string,
    payload: unknown
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`[GitHub-Webhook] Received event: ${eventType}`);

      if (eventType === 'issue_comment') {
        return await this.handlePRReviewCommentEvent(payload as GitHubPRReviewCommentPayload);
      }

      logger.info(`[GitHub-Webhook] Non-comment event received: ${eventType}, skipping`);
      return { success: true, message: `Event ${eventType} acknowledged but not processed` };
    } catch (error) {
      logger.error(`[GitHub-Webhook] Error processing event ${eventType}:`, error);
      return { success: true, message: 'Error acknowledged' };
    }
  }

  private async handlePRReviewCommentEvent(
    payload: GitHubPRReviewCommentPayload
  ): Promise<{ success: boolean; message: string }> {
    if (payload.action !== 'created') {
      return { success: true, message: `Comment ${payload.action} acknowledged` };
    }

    // issue_comment events on regular issues don't have pull_request property
    // For PR comments, the PR data is in payload.issue (PRs are also issues in GitHub's API)
    const issueData = payload.issue;
    const prSpecificData = issueData?.pull_request;
    
    if (!prSpecificData) {
      logger.info('[GitHub-Webhook] Comment on regular issue (not PR), skipping');
      return { success: true, message: 'Issue comment acknowledged but not processed' };
    }

    const prNumber = issueData.number;
    const prUrl = prSpecificData.html_url;
    const commentText = payload.comment.body || '';
    
    logger.info(`[GitHub-Webhook] Processing comment on PR #${prNumber}`);
    logger.info(`[GitHub-Webhook] Comment body: ${commentText}`);

    const mentions = this.extractMentions(commentText);
    logger.info(`[GitHub-Webhook] Extracted mentions: ${mentions.join(', ')}`);

    const isXyneMentioned = mentions.some((m) =>
      m.toLowerCase() === XYNE_MENTION_EMAIL ||
      m.toLowerCase() === XYNE_MENTION_USERNAME
    );

    if (isXyneMentioned) {
      logger.info(
        `[GitHub-Webhook] Detected XyneSpaces mention in PR #${prNumber}`
      );

      await xyneCommentService.handleXyneMention({
        prId: prNumber,
        prUrl: prUrl,
        projectName: payload.repository.owner.login,
        repoName: payload.repository.name,
      });
    }

    return { success: true, message: 'Comment event processed successfully' };
  }

  private extractMentions(text: string): string[] {
    const mentions: string[] = [];
    const emailMentionRegex = /@([\w.-]+@[\w.-]+)/g;
    const simpleMentionRegex = /@([\w-]+)/g;

    let match: RegExpExecArray | null;

    while ((match = emailMentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    while ((match = simpleMentionRegex.exec(text)) !== null) {
      const mentionText = match[1];
      if (!mentions.some((m) => m.includes(mentionText))) {
        mentions.push(mentionText);
      }
    }

    return mentions;
  }
}

export const githubWebhookService = new GitHubWebhookService();
