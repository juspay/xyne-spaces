import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { Board, Channel, ChannelType } from '@prisma/client';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { BoardRepository } from '@/database/repositories/boardRepository';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { logger } from '@/utils/logger';
import { registerExternalSource } from '@/integrations/core/externalSourceRegistry';
import { pkceServiceV2 } from '@/services/pkceServiceV2';
import {
  buildGoogleMailSourceCredentials,
  encryptGoogleMailSourceCredentials,
  getGoogleMailRedirectUri,
  parseGoogleMailSourceCredentials,
  resolveGoogleMailProviderConfig,
  saveGoogleMailSourceCredentials,
} from '@/integrations/google-mail/credentials';
import { googleMailOAuthStateService } from '@/integrations/google-mail/oauthStateService';
import type {
  GoogleMailSourceCredentials,
  GoogleMailSourceResponse,
} from '@/integrations/google-mail/types';
import { googleMailSyncQueue } from '@/queues/googleMailSyncQueue';
import { FULL_SYNC_MAX_MESSAGES } from '@/integrations/google-mail/syncService';
import { googleMailSearchService } from '@/services/vespaSearch/providers/gmail';

interface UpsertGoogleMailSourceBody {
  name?: string;
  displayName?: string;
  channelId?: string;
  boardId?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  isActive?: boolean;
}

const googleMailLogger = logger.child({ module: 'google-mail-controller' });
type GoogleMailSourceRecord = NonNullable<
  Awaited<ReturnType<ExternalSourceRepository['findById']>>
>;

class GoogleMailSetupError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

const normalizeSourceName = (value?: string): string => {
  const candidate = (value || `google-${uuidv4().slice(0, 8)}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!candidate) {
    return `google-${uuidv4().slice(0, 8)}`;
  }

  return candidate.startsWith('google-') ? candidate : `google-${candidate}`;
};

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const renderOAuthResultPage = (params: {
  title: string;
  description: string;
  sourceId?: string;
  success: boolean;
}): string => {
  const payload = JSON.stringify({
    type: 'google-mail-oauth-result',
    sourceId: params.sourceId,
    success: params.success,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(params.title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fa; color: #111827; margin: 0; }
      .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
      .card { width: 100%; max-width: 520px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px; box-shadow: 0 12px 40px rgba(17, 24, 39, 0.08); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0; line-height: 1.5; color: #4b5563; }
      .note { margin-top: 16px; font-size: 14px; color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>${escapeHtml(params.title)}</h1>
        <p>${escapeHtml(params.description)}</p>
        <p class="note">You can close this window.</p>
      </div>
    </div>
    <script>
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(${payload}, '*');
        }
      } catch (_error) {}
      setTimeout(() => {
        window.close();
      }, 1500);
    </script>
  </body>
</html>`;
};

export class GoogleMailController {
  private externalSourceRepo = new ExternalSourceRepository();
  private channelRepo = new ChannelRepository();
  private channelParticipantRepo = new ChannelParticipantRepository();
  private boardRepo = new BoardRepository();

  listSources = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const sources = await this.externalSourceRepo.findAll({
        sourceType: 'google',
      });
      const legacyChannelIds = Array.from(
        new Set(
          sources
            .map(source => source.channelId)
            .filter((channelId): channelId is string => Boolean(channelId))
        )
      );
      const accessibleChannelIds =
        legacyChannelIds.length > 0
          ? await this.channelParticipantRepo.getAccessibleChannelIds(legacyChannelIds, userId)
          : new Set<string>();

      const payload = sources
        .filter(source =>
          source.ownerUserId === userId ||
          (source.channelId ? accessibleChannelIds.has(source.channelId) : false)
        )
        .map(source => this.toResponse(source));
      res.status(200).json(payload);
    } catch (error) {
      googleMailLogger.error('[GOOGLE_MAIL] Failed to list sources', error);
      res.status(500).json({
        error: 'Failed to list Google Mail sources',
      });
    }
  };

  createSource = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as UpsertGoogleMailSourceBody;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      if (!body.displayName) {
        res.status(400).json({
          error: 'displayName is required',
        });
        return;
      }

      const sourceTarget = await this.resolveSourceTarget(userId, body);

      const sourceName = normalizeSourceName(body.name || body.displayName);
      const encryptedCredentials = encryptGoogleMailSourceCredentials(
        buildGoogleMailSourceCredentials({
          clientId: body.clientId,
          clientSecret: body.clientSecret,
          scopes: body.scopes,
        })
      );

      const source = await this.externalSourceRepo.create({
        name: sourceName,
        sourceType: 'google',
        displayName: body.displayName,
        channelId: sourceTarget?.channel.id ?? null,
        boardId: sourceTarget?.board.id ?? null,
        ownerUserId: userId,
        credentials: encryptedCredentials,
      });

      if (sourceTarget?.channel.id) {
        await this.channelRepo.update(sourceTarget.channel.id, {
          type: ChannelType.EMAIL,
        });
      }

      if (sourceTarget?.channel.id) {
        registerExternalSource(source.name, source.displayName);
      }

      res.status(201).json(this.toResponse(source));
    } catch (error: any) {
      if (error instanceof GoogleMailSetupError) {
        res.status(error.statusCode).json({
          error: error.message,
        });
        return;
      }

      googleMailLogger.error('[GOOGLE_MAIL] Failed to create source', error);
      res.status(500).json({
        error: 'Failed to create Google Mail source',
        message: error.message,
      });
    }
  };

  updateSource = async (req: Request, res: Response): Promise<void> => {
    try {
      const { sourceId } = req.params;
      const source = await this.getAuthorizedSource(req, res, sourceId);
      if (!source) {
        return;
      }

      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const body = req.body as UpsertGoogleMailSourceBody;

      const currentCredentials = parseGoogleMailSourceCredentials(source.credentials);
      const nextCredentials: GoogleMailSourceCredentials = {
        ...currentCredentials,
        provider: {
          clientId:
            body.clientId !== undefined
              ? body.clientId.trim() || undefined
              : currentCredentials.provider.clientId,
          clientSecret:
            body.clientSecret !== undefined
              ? body.clientSecret.trim() || undefined
              : currentCredentials.provider.clientSecret,
          scopes:
            body.scopes && body.scopes.length > 0
              ? body.scopes
              : currentCredentials.provider.scopes,
        },
        status:
          currentCredentials.tokens?.refreshToken && currentCredentials.status !== 'pending_auth'
            ? currentCredentials.status
            : 'pending_auth',
      };

      if (body.channelId || body.boardId) {
        const channelId = body.channelId || source.channelId;
        const boardId = body.boardId || source.boardId || undefined;
        if (!channelId) {
          res.status(400).json({ error: 'channelId is required when setting board/channel linkage' });
          return;
        }
        const channel = await this.channelRepo.findById(channelId);

        if (!channel) {
          res.status(404).json({ error: 'Channel not found' });
          return;
        }

        const hasChannelAccess = await this.channelParticipantRepo.isParticipant(
          channelId,
          userId
        );
        if (!hasChannelAccess) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }

        if (boardId) {
          const board = await this.boardRepo.findById(boardId);
          if (!board) {
            res.status(404).json({ error: 'Board not found' });
            return;
          }

          if (board.projectId !== channel.projectId) {
            res.status(400).json({
              error: 'Board and channel must belong to the same project',
            });
            return;
          }
        }
      }

      const updatedSource = await this.externalSourceRepo.update(sourceId, {
        displayName: body.displayName,
        channelId: body.channelId,
        boardId: body.boardId,
        isActive: body.isActive,
      });

      await saveGoogleMailSourceCredentials(sourceId, nextCredentials);

      if (body.channelId) {
        await this.channelRepo.update(body.channelId, {
          type: ChannelType.EMAIL,
        });
      }

      const latestSource = await this.externalSourceRepo.findById(updatedSource.id);
      res.status(200).json(this.toResponse(latestSource));
    } catch (error: any) {
      googleMailLogger.error('[GOOGLE_MAIL] Failed to update source', error);
      res.status(500).json({
        error: 'Failed to update Google Mail source',
        message: error.message,
      });
    }
  };

  startOAuth = async (req: Request, res: Response): Promise<void> => {
    try {
      const { sourceId } = req.query;
      if (!sourceId || typeof sourceId !== 'string') {
        res.status(400).json({ error: 'sourceId query parameter is required' });
        return;
      }

      const source = await this.getAuthorizedSource(req, res, sourceId);
      if (!source) {
        return;
      }

      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const storedCredentials = parseGoogleMailSourceCredentials(source.credentials);
      const providerConfig = resolveGoogleMailProviderConfig(storedCredentials);
      const redirectUri = getGoogleMailRedirectUri(req);
      const oauthClient = new OAuth2Client(
        providerConfig.clientId,
        providerConfig.clientSecret,
        redirectUri
      );

      const state = await googleMailOAuthStateService.createState(source.id, userId);
      const codeVerifier = pkceServiceV2.generateCodeVerifier();
      const codeChallenge = pkceServiceV2.generateCodeChallenge(codeVerifier);
      await pkceServiceV2.storeVerifier(state, codeVerifier);

      const authUrl = oauthClient.generateAuthUrl({
        access_type: 'offline',
        scope: providerConfig.scopes,
        prompt: 'consent',
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      });

      res.redirect(authUrl);
    } catch (error: any) {
      googleMailLogger.error('[GOOGLE_MAIL] Failed to start OAuth', error);
      res.status(500).json({
        error: 'Failed to start Google OAuth',
        message: error.message,
      });
    }
  };

  handleOAuthCallback = async (req: Request, res: Response): Promise<void> => {
    const { code, state, error } = req.query;

    if (error) {
      res
        .status(400)
        .send(
          renderOAuthResultPage({
            title: 'Google Mail connection failed',
            description: String(error),
            success: false,
          })
        );
      return;
    }

    if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
      res
        .status(400)
        .send(
          renderOAuthResultPage({
            title: 'Google Mail connection failed',
            description: 'Missing authorization code or state.',
            success: false,
          })
        );
      return;
    }

    try {
      const isCodeUsed = await googleMailOAuthStateService.isCodeUsed(code);
      if (isCodeUsed) {
        throw new Error('Authorization code has already been used');
      }

      const stateData = await googleMailOAuthStateService.validateState(state, false);
      if (!stateData) {
        throw new Error('OAuth state is invalid or expired');
      }

      const source = await this.externalSourceRepo.findById(stateData.sourceId);
      if (!source || source.sourceType !== 'google') {
        throw new Error('Google Mail source no longer exists');
      }

      const stillHasAccess =
        source.ownerUserId === stateData.userId ||
        (source.channelId
          ? await this.channelParticipantRepo.isParticipant(source.channelId, stateData.userId)
          : false);
      if (!stillHasAccess) {
        throw new Error('You no longer have access to this Gmail source');
      }

      const storedCredentials = parseGoogleMailSourceCredentials(source.credentials);
      const providerConfig = resolveGoogleMailProviderConfig(storedCredentials);
      const redirectUri = getGoogleMailRedirectUri(req);
      const codeVerifier = await pkceServiceV2.getAndDeleteVerifier(state);

      if (!codeVerifier) {
        throw new Error('PKCE verification failed');
      }

      const oauthClient = new OAuth2Client(
        providerConfig.clientId,
        providerConfig.clientSecret,
        redirectUri
      );

      const tokenResponse = await oauthClient.getToken({
        code,
        redirect_uri: redirectUri,
        codeVerifier,
      });

      await googleMailOAuthStateService.markCodeAsUsed(code);
      await googleMailOAuthStateService.deleteState(state);

      const refreshToken =
        tokenResponse.tokens.refresh_token || storedCredentials.tokens?.refreshToken;
      if (!refreshToken) {
        throw new Error('Google did not return a refresh token for this source');
      }

      oauthClient.setCredentials(tokenResponse.tokens);
      const gmailProfileClient = new OAuth2Client(
        providerConfig.clientId,
        providerConfig.clientSecret,
        redirectUri
      );
      gmailProfileClient.setCredentials({
        access_token: tokenResponse.tokens.access_token || storedCredentials.tokens?.accessToken,
        refresh_token: refreshToken,
      });

      const gmailApi = (await import('googleapis')).google.gmail({
        version: 'v1',
        auth: gmailProfileClient as any,
      });
      const profile = await gmailApi.users.getProfile({ userId: 'me' });

      const nextCredentials: GoogleMailSourceCredentials = {
        ...storedCredentials,
        tokens: {
          accessToken: tokenResponse.tokens.access_token || storedCredentials.tokens?.accessToken,
          refreshToken,
          accessTokenExpiresAt: tokenResponse.tokens.expiry_date
            ? new Date(tokenResponse.tokens.expiry_date).toISOString()
            : storedCredentials.tokens?.accessTokenExpiresAt ?? null,
        },
        mailbox: {
          ...(storedCredentials.mailbox || {}),
          emailAddress: profile.data.emailAddress || storedCredentials.mailbox?.emailAddress,
          historyId: storedCredentials.mailbox?.historyId ?? null,
          lastSyncedAt: storedCredentials.mailbox?.lastSyncedAt ?? null,
        },
        status: 'authenticated',
        lastError: null,
      };

      await saveGoogleMailSourceCredentials(source.id, nextCredentials);

      res
        .status(200)
        .send(
          renderOAuthResultPage({
            title: 'Google mailbox connected',
            description: `Mailbox ${profile.data.emailAddress || 'connected'} is ready for ingestion.`,
            sourceId: source.id,
            success: true,
          })
        );
    } catch (callbackError: any) {
      googleMailLogger.error('[GOOGLE_MAIL] OAuth callback failed', callbackError);
      res
        .status(500)
        .send(
          renderOAuthResultPage({
            title: 'Google Mail connection failed',
            description: callbackError.message || 'Unknown OAuth callback error',
            success: false,
          })
        );
    }
  };

  startIngestion = async (req: Request, res: Response): Promise<void> => {
    try {
      const { sourceId } = req.params;
      const source = await this.getAuthorizedSource(req, res, sourceId);
      if (!source) {
        return;
      }

      const storedCredentials = parseGoogleMailSourceCredentials(source.credentials);
      if (!storedCredentials.tokens?.refreshToken) {
        res.status(400).json({
          error: 'Google Mail source is not authenticated',
        });
        return;
      }

      await saveGoogleMailSourceCredentials(sourceId, {
        ...storedCredentials,
        mailbox: {
          ...(storedCredentials.mailbox || {}),
          syncProcessedMessages: 0,
          syncTotalMessages: FULL_SYNC_MAX_MESSAGES,
          syncStartedAt: new Date().toISOString(),
          syncMode: 'full',
        },
        status: 'syncing',
        lastError: null,
      });

      await googleMailSyncQueue.enqueueFullSync(sourceId);

      res.status(202).json({
        success: true,
        sourceId,
        message: 'Google Mail ingestion scheduled',
      });
    } catch (error: any) {
      googleMailLogger.error('[GOOGLE_MAIL] Failed to schedule ingestion', error);
      res.status(500).json({
        error: 'Failed to start Google Mail ingestion',
        message: error.message,
      });
    }
  };

  searchMessages = async (req: Request, res: Response): Promise<void> => {
    try {
      const userEmail = req.user?.email;
      if (!userEmail) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
      const offset = this.parseNumber(req.query.offset, 0);
      const limit = this.parseNumber(req.query.limit, 20);
      const sortBy = req.query.sortBy === 'asc' ? 'asc' : 'desc';
      const labels = this.parseCsv(req.query.labels);
      const after = this.parseTimestamp(req.query.after);
      const before = this.parseTimestamp(req.query.before);

      if ((req.query.after && after === null) || (req.query.before && before === null)) {
        res.status(400).json({ error: 'Invalid before/after date filter' });
        return;
      }

      if (after !== null && before !== null && after > before) {
        res.status(400).json({ error: 'after must be earlier than before' });
        return;
      }

      const results = await googleMailSearchService.search({
        email: userEmail,
        query: q || undefined,
        offset,
        limit,
        sortBy,
        labels: labels.length > 0 ? labels : undefined,
        participants: this.buildParticipantFilters(req),
        timeRange:
          after !== null || before !== null
            ? {
                startTime: after ?? 0,
                endTime: before ?? Date.now(),
              }
            : undefined,
      });

      res.status(200).json({
        success: true,
        data: results,
      });
    } catch (error: any) {
      googleMailLogger.error('[GOOGLE_MAIL] Failed to search mailbox', error);
      res.status(500).json({
        error: 'Failed to search Google Mail',
        message: error.message,
      });
    }
  };

  private async getAuthorizedSource(
    req: Request,
    res: Response,
    sourceId: string
  ): Promise<GoogleMailSourceRecord | null> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return null;
    }

    const source = await this.externalSourceRepo.findById(sourceId);
    if (!source || source.sourceType !== 'google') {
      res.status(404).json({ error: 'Google Mail source not found' });
      return null;
    }

    const hasAccess =
      source.ownerUserId === userId ||
      (source.channelId
        ? await this.channelParticipantRepo.isParticipant(source.channelId, userId)
        : false);
    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }

    return source;
  }

  private async resolveSourceTarget(
    userId: string,
    body: UpsertGoogleMailSourceBody
  ): Promise<{ channel: Channel; board: Board } | null> {
    if (body.channelId && body.boardId) {
      const channel = await this.channelRepo.findById(body.channelId);
      if (!channel) {
        throw new GoogleMailSetupError('Channel not found', 404);
      }

      const hasChannelAccess = await this.channelParticipantRepo.isParticipant(body.channelId, userId);
      if (!hasChannelAccess) {
        throw new GoogleMailSetupError('Forbidden', 403);
      }

      const board = await this.boardRepo.findById(body.boardId);
      if (!board) {
        throw new GoogleMailSetupError('Board not found', 404);
      }

      if (board.projectId !== channel.projectId) {
        throw new GoogleMailSetupError('Board and channel must belong to the same project', 400);
      }

      return { channel, board };
    }

    if (body.channelId || body.boardId) {
      throw new GoogleMailSetupError('channelId and boardId must be provided together', 400);
    }

    return null;
  }

  private parseCsv(value: unknown): string[] {
    if (typeof value !== 'string') {
      return [];
    }

    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  private parseNumber(value: unknown, fallback: number): number {
    if (typeof value !== 'string') {
      return fallback;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed) || parsed < 0) {
      return fallback;
    }

    return parsed;
  }

  private parseTimestamp(value: unknown): number | null {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    const parsed = new Date(value);
    const timestamp = parsed.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  private buildParticipantFilters(req: Request): {
    from?: string[];
    to?: string[];
    cc?: string[];
    bcc?: string[];
  } | undefined {
    const participants = {
      from: this.parseCsv(req.query.from),
      to: this.parseCsv(req.query.to),
      cc: this.parseCsv(req.query.cc),
      bcc: this.parseCsv(req.query.bcc),
    };

    const hasParticipants = Object.values(participants).some(values => values.length > 0);
    return hasParticipants ? participants : undefined;
  }

  private toResponse(source: Awaited<ReturnType<ExternalSourceRepository['findById']>>): GoogleMailSourceResponse {
    if (!source) {
      throw new Error('Source is required');
    }

    const storedCredentials = parseGoogleMailSourceCredentials(source.credentials);

    return {
      id: source.id,
      name: source.name,
      displayName: source.displayName,
      channelId: source.channelId ?? null,
      boardId: source.boardId,
      isActive: source.isActive,
      status: storedCredentials.status,
      mailboxEmail: storedCredentials.mailbox?.emailAddress,
      lastSyncedAt: storedCredentials.mailbox?.lastSyncedAt ?? null,
      syncProcessedMessages: storedCredentials.mailbox?.syncProcessedMessages ?? null,
      syncTotalMessages: storedCredentials.mailbox?.syncTotalMessages ?? null,
      syncStartedAt: storedCredentials.mailbox?.syncStartedAt ?? null,
      syncMode: storedCredentials.mailbox?.syncMode ?? null,
      lastError: storedCredentials.lastError ?? null,
      scopes: storedCredentials.provider.scopes,
      hasRefreshToken: Boolean(storedCredentials.tokens?.refreshToken),
      hasCustomProviderConfig: Boolean(
        storedCredentials.provider.clientId && storedCredentials.provider.clientSecret
      ),
      oauthStartUrl: `/api/google-mail/oauth/start?sourceId=${source.id}`,
    };
  }
}
