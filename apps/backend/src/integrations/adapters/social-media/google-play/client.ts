import crypto from 'crypto';
import { google, type androidpublisher_v3 } from 'googleapis';
import type { ExternalSource } from '@prisma/client';
import { db } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { GOOGLE_PLAY_SCOPE } from './constants';

const GOOGLE_PLAY_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

export interface GooglePlayCredentials {
  clientEmail: string;
  privateKey: string;
}

export class GooglePlayKeyError extends Error {}

export function parseServiceAccountKey(json: string): GooglePlayCredentials {
  let key: { type?: unknown; client_email?: unknown; private_key?: unknown };
  try {
    key = JSON.parse(json);
  } catch {
    throw new GooglePlayKeyError('The service account key is not valid JSON');
  }
  if (
    key?.type !== 'service_account' ||
    typeof key.client_email !== 'string' ||
    typeof key.private_key !== 'string'
  ) {
    throw new GooglePlayKeyError(
      'Upload the JSON key of a Google Cloud service account (type "service_account")'
    );
  }
  try {
    crypto.createPrivateKey(key.private_key);
  } catch {
    throw new GooglePlayKeyError('The private_key in this file is not a valid key');
  }
  return { clientEmail: key.client_email, privateKey: key.private_key };
}

export function readSourceCredentials(source: Pick<ExternalSource, 'credentials'>): GooglePlayCredentials {
  if (!source.credentials) {
    throw new GooglePlayKeyError(
      'The service account key was deleted when this desk was disconnected. Use "Replace key" to upload one.'
    );
  }
  const credentials = JSON.parse(decrypt(source.credentials)) as Partial<GooglePlayCredentials>;
  if (!credentials.clientEmail || !credentials.privateKey) {
    throw new GooglePlayKeyError(
      'Google Play source still uses retired OAuth credentials; upload a service account key'
    );
  }
  return { clientEmail: credentials.clientEmail, privateKey: credentials.privateKey };
}

// 403, never 401: the dashboard logs the user out on any 401.
export function toGooglePlayErrorResponse(
  error: unknown,
  context: { clientEmail?: string; packageName?: string } = {},
): { status: number; error: string } | null {
  if (error instanceof GooglePlayKeyError) return { status: 400, error: error.message };
  const response = (error as { response?: { status?: unknown; data?: { error?: unknown } } })
    ?.response;
  if (response?.status === 400 && response.data?.error === 'invalid_grant') {
    return {
      status: 400,
      error:
        'Google rejected this service account key. It may be deleted or disabled; create a new key and upload it.',
    };
  }
  const googleReason = error instanceof Error ? ` Google said: ${error.message}` : '';
  if (response?.status === 404) {
    return {
      status: 404,
      error: `Google Play could not find ${context.packageName ?? 'this app or review'}.${googleReason}`,
    };
  }
  if (response?.status !== 401 && response?.status !== 403) return null;
  const account = context.clientEmail ?? 'The service account';
  return {
    status: 403,
    error: `${account} cannot access ${context.packageName ?? 'this app'}. Invite it in Play Console with View app information and Reply to reviews, and check the Google Play Android Developer API is enabled on its Cloud project.${googleReason}`,
  };
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

export function getGooglePlayReviewLastModifiedAt(review: NormalizedGooglePlayReview): number {
  return Math.max(review.occurredAt.getTime(), review.developerReply?.occurredAt.getTime() ?? 0);
}

function timestampToDate(value?: androidpublisher_v3.Schema$Timestamp): Date {
  const seconds = Number(value?.seconds ?? 0);
  const nanos = Number(value?.nanos ?? 0);
  const millis = seconds > 0 ? seconds * 1000 + Math.floor(nanos / 1_000_000) : Date.now();
  return new Date(millis);
}

export class GooglePlayClient {
  private createAuth(credentials: GooglePlayCredentials) {
    return new google.auth.JWT({
      email: credentials.clientEmail,
      key: credentials.privateKey,
      scopes: [GOOGLE_PLAY_SCOPE],
    });
  }

  async validatePackage(credentials: GooglePlayCredentials, packageName: string): Promise<void> {
    const publisher = google.androidpublisher({
      version: 'v3',
      auth: this.createAuth(credentials),
    });
    await publisher.reviews.list(
      { packageName, maxResults: 1 },
      { timeout: GOOGLE_PLAY_REQUEST_TIMEOUT_MS }
    );
  }

  async listReviews(
    source: ExternalSource,
    modifiedAfter?: Date
  ): Promise<NormalizedGooglePlayReview[]> {
    const auth = this.createAuth(readSourceCredentials(source));
    const publisher = google.androidpublisher({ version: 'v3', auth });
    const reviews: NormalizedGooglePlayReview[] = [];
    const modifiedAfterTimestamp = modifiedAfter?.getTime();
    let token: string | undefined;
    do {
      const response = await publisher.reviews.list(
        {
          packageName: source.externalIdentifier!,
          maxResults: 100,
          ...(token && { token }),
        },
        { timeout: GOOGLE_PLAY_REQUEST_TIMEOUT_MS }
      );
      const pageReviews: NormalizedGooglePlayReview[] = [];
      for (const review of response.data.reviews ?? []) {
        if (!review.reviewId) continue;
        const userComment = review.comments?.find((comment) => comment.userComment)?.userComment;
        if (!userComment?.text) continue;
        const developerComment = review.comments?.find(
          (comment) => comment.developerComment
        )?.developerComment;
        const authorName = review.authorName ?? undefined;
        const rating = userComment.starRating ?? undefined;
        pageReviews.push({
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
      reviews.push(
        ...pageReviews.filter(
          (review) =>
            modifiedAfterTimestamp === undefined ||
            getGooglePlayReviewLastModifiedAt(review) >= modifiedAfterTimestamp
        )
      );

      // Google returns the most recently created or modified reviews first. Once a
      // complete page is older than the cutoff, subsequent pages are outside this sync.
      if (
        modifiedAfterTimestamp !== undefined &&
        pageReviews.length > 0 &&
        pageReviews.every(
          (review) => getGooglePlayReviewLastModifiedAt(review) < modifiedAfterTimestamp
        )
      ) {
        break;
      }
      token = response.data.tokenPagination?.nextPageToken ?? undefined;
    } while (token);
    return reviews;
  }

  async reply(sourceId: string, reviewId: string, body: string): Promise<Date> {
    const source = await db.externalSource.findUniqueOrThrow({ where: { id: sourceId } });
    const publisher = google.androidpublisher({
      version: 'v3',
      auth: this.createAuth(readSourceCredentials(source)),
    });
    const response = await publisher.reviews.reply(
      {
        packageName: source.externalIdentifier!,
        reviewId,
        requestBody: { replyText: body },
      },
      { timeout: GOOGLE_PLAY_REQUEST_TIMEOUT_MS }
    );
    return timestampToDate(response.data.result?.lastEdited);
  }
}

export const googlePlayClient = new GooglePlayClient();
