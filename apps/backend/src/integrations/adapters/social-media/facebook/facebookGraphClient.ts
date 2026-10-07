import axios from 'axios';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { SenderNameCache } from '../shared/senderNameCache';

const FB_API_VERSION = 'v25.0';
const FB_REQUEST_TIMEOUT_MS = 10_000;
const FB_BASE_URL = `https://graph.facebook.com/${FB_API_VERSION}`;
export const FB_DIALOG_URL = `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth`;

const PAGE_SUBSCRIBED_FIELDS = 'messages,message_edits,feed,mention';

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
}

// Upper bound on follow-up pages per list, so one fetch cannot run away on a very busy Page.
const MAX_HISTORY_PAGES = 40;

interface Paged<T> {
  data?: T[];
  paging?: { next?: string };
}

export interface FacebookHistoryMessage {
  id: string;
  created_time: string;
  from?: { id?: string; name?: string };
  message?: string;
  attachments?: {
    data?: Array<{
      mime_type?: string;
      image_data?: { url?: string };
      video_data?: { url?: string };
      file_url?: string;
    }>;
  };
}

export interface FacebookHistoryComment {
  id: string;
  created_time: string;
  from?: { id?: string; name?: string };
  message?: string;
  parent?: { id: string };
  permalink_url?: string;
}

export interface FacebookTaggedPost {
  id: string;
  created_time: string;
  from?: { id?: string; name?: string };
  message?: string;
  permalink_url?: string;
}

/**
 * Yields one page at a time, following paging.next (a full URL that already carries the query
 * string) until `done` says the latest page reached far enough back, or the page cap is hit.
 */
async function* iteratePages<T>(
  accessToken: string,
  first: Paged<T> | undefined,
  done: (page: T[]) => boolean,
): AsyncGenerator<T[]> {
  let page = first;
  for (let fetched = 0; page; fetched++) {
    const data = page.data ?? [];
    yield data;
    if (!page.paging?.next || done(data) || fetched >= MAX_HISTORY_PAGES) return;
    page = (await axios.get<Paged<T>>(page.paging.next, bearer(accessToken))).data;
  }
}

async function collectPages<T>(
  accessToken: string,
  first: Paged<T> | undefined,
  done: (page: T[]) => boolean,
): Promise<T[]> {
  const items: T[] = [];
  for await (const page of iteratePages(accessToken, first, done)) items.push(...page);
  return items;
}

const olderThan =
  <T>(since: Date, time: (item: T) => string | undefined) =>
  (page: T[]): boolean => {
    const last = page[page.length - 1];
    const lastTime = last ? time(last) : undefined;
    return !lastTime || Date.parse(lastTime) < since.getTime();
  };

function bearer(accessToken: string) {
  return { headers: { Authorization: `Bearer ${accessToken}` }, timeout: FB_REQUEST_TIMEOUT_MS };
}

const senderNameCache = new SenderNameCache();

const graphErrorCode = (error: unknown): number | undefined =>
  (error as { response?: { data?: { error?: { code?: number } } } })?.response?.data?.error?.code;

// Page tokens have no expiry date, but Meta invalidates them when the admin who connected the
// Page changes their password, loses their Page role, or removes the app (Graph error 190).
export function isFacebookTokenRejected(error: unknown): boolean {
  return graphErrorCode(error) === 190;
}

// Meta's throttling codes: app (4), user (17), Page (32) and custom (613) rate limits.
export function isFacebookRateLimited(error: unknown): boolean {
  return [4, 17, 32, 613].includes(graphErrorCode(error) ?? -1);
}

// Codes Meta returns when a tagged send is refused: outside the allowed window (10) or the
// app lacks the permission/feature (200).
export function isFacebookTagRejected(error: unknown): boolean {
  return [10, 200].includes(graphErrorCode(error) ?? -1);
}

export const facebookGraphClient = {
  // Exchange the authorization code for a short-lived user token.
  async exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
    const response = await axios.get<{ access_token: string }>(`${FB_BASE_URL}/oauth/access_token`, {
      params: {
        client_id: config.META_APP_ID,
        client_secret: config.META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      },
      timeout: FB_REQUEST_TIMEOUT_MS,
    });
    return response.data.access_token;
  },

  // Page tokens minted from a long-lived user token do not expire, so no refresh worker is needed.
  async getLongLivedUserToken(shortLivedToken: string): Promise<string> {
    const response = await axios.get<{ access_token: string }>(`${FB_BASE_URL}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: config.META_APP_ID,
        client_secret: config.META_APP_SECRET,
        fb_exchange_token: shortLivedToken,
      },
      timeout: FB_REQUEST_TIMEOUT_MS,
    });
    return response.data.access_token;
  },

  async getUserId(userAccessToken: string): Promise<string> {
    const response = await axios.get<{ id: string }>(`${FB_BASE_URL}/me`, {
      params: { fields: 'id' },
      ...bearer(userAccessToken),
    });
    return response.data.id;
  },

  // Pages the user granted in the Facebook Login dialog, each with its own Page access token.
  async getPages(userAccessToken: string): Promise<FacebookPage[]> {
    const pages: FacebookPage[] = [];
    let url: string | undefined = `${FB_BASE_URL}/me/accounts`;
    let params: Record<string, string> | undefined = { fields: 'id,name,access_token', limit: '100' };
    while (url) {
      const response: { data: { data?: FacebookPage[]; paging?: { next?: string } } } =
        await axios.get(url, { params, ...bearer(userAccessToken) });
      pages.push(...(response.data.data ?? []));
      // paging.next is a full URL that already carries the query string.
      url = response.data.paging?.next;
      params = undefined;
    }
    return pages;
  },

  // Requires the app-level Page webhook to be configured in the Meta App Dashboard first.
  async subscribePage(pageAccessToken: string, pageId: string): Promise<void> {
    try {
      await axios.post(`${FB_BASE_URL}/${pageId}/subscribed_apps`, null, {
        params: { subscribed_fields: PAGE_SUBSCRIBED_FIELDS },
        ...bearer(pageAccessToken),
      });
    } catch (err) {
      const axiosErr = err as import('axios').AxiosError;
      logger.error('[facebookGraphClient] subscribePage FAILED', {
        pageId,
        status: axiosErr.response?.status,
        responseData: axiosErr.response?.data,
        message: axiosErr.message,
      });
      throw err;
    }
  },

  async unsubscribePage(pageAccessToken: string, pageId: string): Promise<void> {
    await axios.delete(`${FB_BASE_URL}/${pageId}/subscribed_apps`, bearer(pageAccessToken));
  },

  async sendMessage(
    pageAccessToken: string,
    pageId: string,
    recipientPsid: string,
    text: string,
    // Outside the 24h window a reply must carry the Human Agent tag.
    humanAgent = false,
  ): Promise<{ recipient_id: string; message_id: string }> {
    const response = await axios.post<{ recipient_id: string; message_id: string }>(
      `${FB_BASE_URL}/${pageId}/messages`,
      {
        recipient: { id: recipientPsid },
        message: { text },
        ...(humanAgent
          ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }
          : { messaging_type: 'RESPONSE' }),
      },
      bearer(pageAccessToken),
    );
    return response.data;
  },

  async replyToComment(
    pageAccessToken: string,
    commentId: string,
    text: string,
  ): Promise<{ id: string }> {
    const response = await axios.post<{ id: string }>(
      `${FB_BASE_URL}/${commentId}/comments`,
      { message: text },
      bearer(pageAccessToken),
    );
    return response.data;
  },

  // Messenger conversations touched since `since`, newest first, one page (25) at a time, each
  // with its latest messages. Meta only returns details for the 20 most recent messages of a
  // conversation and errors on older ones, so messages are capped there and never paged.
  async *conversationPages(
    pageAccessToken: string,
    pageId: string,
    since: Date,
  ): AsyncGenerator<Array<{ id: string; messages: FacebookHistoryMessage[] }>> {
    type Conversation = { id: string; updated_time?: string; messages?: Paged<FacebookHistoryMessage> };
    const first = await axios.get<Paged<Conversation>>(`${FB_BASE_URL}/${pageId}/conversations`, {
      params: {
        platform: 'messenger',
        fields:
          'id,updated_time,messages.limit(20){id,created_time,from,message,attachments{mime_type,image_data,video_data,file_url}}',
        limit: '25',
      },
      ...bearer(pageAccessToken),
    });
    const pages = iteratePages(
      pageAccessToken,
      first.data,
      olderThan<Conversation>(since, (conversation) => conversation.updated_time),
    );
    for await (const page of pages) {
      yield page
        .filter(
          (conversation) =>
            !conversation.updated_time || Date.parse(conversation.updated_time) >= since.getTime(),
        )
        .map((conversation) => ({
          id: conversation.id,
          messages: conversation.messages?.data ?? [],
        }));
    }
  },

  // The Page's posts, one page (25) at a time, with the comments and replies made on them since
  // `since` (filter=stream includes replies; newest first, so paging stops at the cutoff).
  // A comment's date is unrelated to its post's, so posts are not cut off by date — only by
  // the page cap, or to the newest 25 when `recentOnly` is set.
  async *postPages(
    pageAccessToken: string,
    pageId: string,
    since: Date,
    recentOnly = false,
  ): AsyncGenerator<Array<{ id: string; comments: FacebookHistoryComment[] }>> {
    type Post = { id: string; comments?: Paged<FacebookHistoryComment> };
    const first = await axios.get<Paged<Post>>(`${FB_BASE_URL}/${pageId}/feed`, {
      params: {
        fields:
          'id,comments.filter(stream).order(reverse_chronological).limit(100){id,created_time,from,message,parent{id},permalink_url}',
        limit: '25',
      },
      ...bearer(pageAccessToken),
    });
    for await (const page of iteratePages(pageAccessToken, first.data, () => recentOnly)) {
      const posts: Array<{ id: string; comments: FacebookHistoryComment[] }> = [];
      for (const post of page) {
        posts.push({
          id: post.id,
          comments: await collectPages(
            pageAccessToken,
            post.comments,
            olderThan<FacebookHistoryComment>(since, (comment) => comment.created_time),
          ),
        });
      }
      yield posts;
    }
  },

  // Posts that tag the Page, newest first, back to `since`.
  async listTaggedPosts(
    pageAccessToken: string,
    pageId: string,
    since: Date,
  ): Promise<FacebookTaggedPost[]> {
    const first = await axios.get<Paged<FacebookTaggedPost>>(`${FB_BASE_URL}/${pageId}/tagged`, {
      params: { fields: 'id,created_time,from,message,permalink_url', limit: '50' },
      ...bearer(pageAccessToken),
    });
    return collectPages(
      pageAccessToken,
      first.data,
      olderThan<FacebookTaggedPost>(since, (post) => post.created_time),
    );
  },

  // Permalink and author of a post or comment. Meta may withhold either for privacy, or refuse
  // the read entirely for content on other people's timelines. Ids are digits and underscores;
  // validate before putting one in the URL.
  async getPostOrComment(
    pageAccessToken: string,
    objectId: string,
  ): Promise<{ permalink_url?: string; from?: { id?: string; name?: string } } | null> {
    if (!/^[0-9_]{1,128}$/.test(objectId)) return null;
    try {
      const response = await axios.get<{
        permalink_url?: string;
        from?: { id?: string; name?: string };
      }>(`${FB_BASE_URL}/${objectId}`, {
        params: { fields: 'permalink_url,from' },
        ...bearer(pageAccessToken),
      });
      return response.data;
    } catch {
      return null;
    }
  },

  // Display name of a Messenger sender, cached per Page (PSIDs are Page-scoped). PSIDs are
  // numeric; validate before putting one in the URL.
  async getSenderName(
    pageAccessToken: string,
    pageId: string,
    psid: string,
  ): Promise<string | null> {
    if (!/^[0-9]{1,64}$/.test(psid)) return null;
    const cacheKey = `${pageId}:${psid}`;
    const cached = senderNameCache.get(cacheKey);
    if (cached !== undefined) return cached;
    try {
      const response = await axios.get<{ name?: string }>(`${FB_BASE_URL}/${psid}`, {
        params: { fields: 'name' },
        ...bearer(pageAccessToken),
      });
      const name = response.data.name ?? null;
      if (name) senderNameCache.set(cacheKey, name);
      return name;
    } catch {
      return null;
    }
  },
};
