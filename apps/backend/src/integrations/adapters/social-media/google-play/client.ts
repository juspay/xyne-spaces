import { google, type androidpublisher_v3 } from 'googleapis';
import { CodeChallengeMethod } from 'google-auth-library';
import { db } from '@/database/client';
import { decrypt, encrypt } from '@/services/encryptionService';
import { GOOGLE_PLAY_SCOPE } from './constants';

export interface GooglePlayCredentials {
  accessToken: string;
  refreshToken: string;
  expiryDate?: number;
}

export interface GooglePlayAuthorization {
  credentials: GooglePlayCredentials;
}

export interface NormalizedGooglePlayReview {
  reviewId: string;
  authorName?: string;
  subject: string;
  body: string;
  rating?: number;
  clientVersionName?: string;
  clientVersionCode?: string;
  thumbsUpCount: number;
  thumbsDownCount: number;
  occurredAt: Date;
  developerReply?: {
    body: string;
    occurredAt: Date;
  };
}

function timestampToDate(value?: androidpublisher_v3.Schema$Timestamp): Date {
  const seconds = Number(value?.seconds ?? 0);
  const nanos = Number(value?.nanos ?? 0);
  const millis = seconds > 0 ? seconds * 1000 + Math.floor(nanos / 1_000_000) : Date.now();
  return new Date(millis);
}

export class GooglePlayClient {
  private createOAuthClient(credentials?: GooglePlayCredentials, redirectUri?: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Google OAuth is not configured');
    const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    if (credentials) {
      client.setCredentials({
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
        expiry_date: credentials.expiryDate,
      });
    }
    return client;
  }

  createAuthorizationUrl(params: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string {
    return this.createOAuthClient(undefined, params.redirectUri).generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      state: params.state,
      scope: [GOOGLE_PLAY_SCOPE],
      code_challenge: params.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
  }

  async exchangeAuthorizationCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GooglePlayAuthorization> {
    const auth = this.createOAuthClient(undefined, params.redirectUri);
    const { tokens } = await auth.getToken({
      code: params.code,
      codeVerifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
    });
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Google did not return the required offline credentials');
    }

    return {
      credentials: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date ?? undefined,
      },
    };
  }

  async validatePackage(credentials: GooglePlayCredentials, packageName: string): Promise<void> {
    const publisher = google.androidpublisher({
      version: 'v3',
      auth: this.createOAuthClient(credentials),
    });
    await publisher.reviews.list({ packageName, maxResults: 1 });
  }

  async listReviews(sourceId: string): Promise<NormalizedGooglePlayReview[]> {
    const source = await db.externalSource.findUniqueOrThrow({ where: { id: sourceId } });
    const credentials = JSON.parse(decrypt(source.credentials)) as GooglePlayCredentials;
    const auth = this.createOAuthClient(credentials);
    auth.on('tokens', (tokens) => {
      if (!tokens.access_token && !tokens.expiry_date) return;
      const next: GooglePlayCredentials = {
        ...credentials,
        ...(tokens.access_token && { accessToken: tokens.access_token }),
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        ...(tokens.expiry_date && { expiryDate: tokens.expiry_date }),
      };
      void db.externalSource
        .update({
          where: { id: sourceId },
          data: { credentials: encrypt(JSON.stringify(next)) },
        })
        .catch(() => {
          // The refresh token remains valid, so a later request can refresh again.
        });
    });

    const publisher = google.androidpublisher({ version: 'v3', auth });
    const reviews: NormalizedGooglePlayReview[] = [];
    let token: string | undefined;
    do {
      const response = await publisher.reviews.list({
        packageName: source.externalIdentifier!,
        maxResults: 100,
        ...(token && { token }),
      });
      for (const review of response.data.reviews ?? []) {
        if (!review.reviewId) continue;
        const userComment = review.comments?.find((comment) => comment.userComment)?.userComment;
        if (!userComment?.text) continue;
        const developerComment = review.comments?.find(
          (comment) => comment.developerComment
        )?.developerComment;
        const authorName = review.authorName ?? undefined;
        const rating = userComment.starRating ?? undefined;
        reviews.push({
          reviewId: review.reviewId,
          authorName,
          subject: `${rating ? `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} ` : ''}${source.displayName} review${authorName ? ` from ${authorName}` : ''}`,
          body: userComment.text,
          rating,
          clientVersionName: userComment.appVersionName ?? undefined,
          clientVersionCode:
            userComment.appVersionCode != null ? String(userComment.appVersionCode) : undefined,
          thumbsUpCount: userComment.thumbsUpCount ?? 0,
          thumbsDownCount: userComment.thumbsDownCount ?? 0,
          occurredAt: timestampToDate(userComment.lastModified),
          ...(developerComment?.text && {
            developerReply: {
              body: developerComment.text,
              occurredAt: timestampToDate(developerComment.lastModified),
            },
          }),
        });
      }
      token = response.data.tokenPagination?.nextPageToken ?? undefined;
    } while (token);
    return reviews;
  }

  async reply(sourceId: string, reviewId: string, body: string): Promise<Date> {
    const source = await db.externalSource.findUniqueOrThrow({ where: { id: sourceId } });
    const credentials = JSON.parse(decrypt(source.credentials)) as GooglePlayCredentials;
    const publisher = google.androidpublisher({
      version: 'v3',
      auth: this.createOAuthClient(credentials),
    });
    const response = await publisher.reviews.reply({
      packageName: source.externalIdentifier!,
      reviewId,
      requestBody: { replyText: body },
    });
    return timestampToDate(response.data.result?.lastEdited);
  }
}

export const googlePlayClient = new GooglePlayClient();
