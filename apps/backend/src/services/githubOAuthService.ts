import crypto from 'crypto';
import { Octokit } from 'octokit';
import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { encrypt } from '@/services/encryptionService';

/**
 * Self-contained GitHub OAuth "link" flow (NOT a login/session).
 * A GitHub reporter authorizes → we capture their verified email → if a
 * community member has that email, we link githubUserId → community userId.
 * After that, their github-issue tickets are created under their name.
 */
export class GithubOAuthService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  private get stateSecret(): string {
    return config.github?.oauthStateSecret || '';
  }

  /** Signed, short-lived state for CSRF protection (no server-side storage). */
  generateState(): string {
    const payload = `${crypto.randomBytes(16).toString('hex')}.${Date.now()}`;
    const sig = crypto.createHmac('sha256', this.stateSecret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  verifyState(state: string): boolean {
    const parts = state.split('.');
    if (parts.length !== 3) { return false; }
    const [nonce, ts, sig] = parts;
    const expected = crypto.createHmac('sha256', this.stateSecret).update(`${nonce}.${ts}`).digest('hex');
    if (sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return false;
    }
    const age = Date.now() - Number(ts);
    return Number.isFinite(age) && age >= 0 && age < 15 * 60 * 1000; // 15 min
  }

  buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: config.github?.oauthClientId || '',
      redirect_uri: config.github?.oauthCallbackUrl || '',
      scope: 'read:user user:email',
      state,
      allow_signup: 'false',
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(code: string): Promise<{ linked: boolean; message: string }> {
    const clientId = config.github?.oauthClientId || '';
    const clientSecret = config.github?.oauthClientSecret || '';
    const communityWorkspaceId = config.community?.workspaceId || '';
    if (!clientId || !clientSecret || !communityWorkspaceId) {
      return { linked: false, message: 'GitHub OAuth is not configured.' };
    }

    // 1. Exchange the code for an access token.
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: config.github?.oauthCallbackUrl,
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      return { linked: false, message: 'Failed to obtain a GitHub access token.' };
    }

    // 2. Read GitHub identity + verified email (Octokit, authed as the user).
    const octokit = new Octokit({ auth: accessToken });
    const { data: ghUser } = await octokit.rest.users.getAuthenticated();
    const { data: emails } = await octokit.rest.users.listEmailsForAuthenticatedUser();
    const primary = Array.isArray(emails)
      ? emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)
      : undefined;

    if (!ghUser.id || !ghUser.login || !primary?.email) {
      logger.warn(
        `[GitHub-OAuth] link failed: githubId=${ghUser?.id} login=${ghUser?.login} ` +
        `emails=${Array.isArray(emails) ? `[${emails.length}]` : JSON.stringify(emails).slice(0, 200)}`
      );
      return {
        linked: false,
        message:
          'Could not read your GitHub id or a verified email. ' +
          'The GitHub App needs the "Email addresses" account permission (read).',
      };
    }

    // 3. Find a community member with that email (email may differ from their
    //    GitHub email — if no match, we simply do not link).
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: primary.email, mode: 'insensitive' },
        workspaceId: communityWorkspaceId,
      },
    });
    if (!user) {
      return {
        linked: false,
        message:
          `No community member found for ${primary.email}. ` +
          'Please join the community first, then come back and re-link your GitHub account. ' +
          'Until then, your issues will stay under the bot.',
      };
    }

    // 4. Store the link on the existing per-user external-provider table
    //    (provider='github', providerUserId=<github numeric id>). No new table.
    //    The GitHub access token is AES-encrypted (same as Slack), so the row is
    //    a proper external-token record, not a placeholder.
    const encryptedToken = encrypt(accessToken);
    await this.prisma.userExternalToken.upsert({
      where: { userId_provider: { userId: user.id, provider: 'github' } },
      create: {
        userId: user.id,
        provider: 'github',
        providerUserId: String(ghUser.id),
        encryptedToken,
        workspaceId: communityWorkspaceId,
        connectedAt: new Date(),
      },
      update: {
        providerUserId: String(ghUser.id),
        encryptedToken,
        workspaceId: communityWorkspaceId,
        connectedAt: new Date(),
      },
    });

    logger.info(`[GitHub-OAuth] Linked githubId=${ghUser.id} (@${ghUser.login}) → community user ${user.id}`);
    return {
      linked: true,
      message: `Linked @${ghUser.login} to ${user.email}. New issues you open will be filed under your name.`,
    };
  }
}

export const githubOAuthService = new GithubOAuthService();
