import axios from 'axios';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

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

function bearer(accessToken: string) {
  return { headers: { Authorization: `Bearer ${accessToken}` }, timeout: FB_REQUEST_TIMEOUT_MS };
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
  ): Promise<{ recipient_id: string; message_id: string }> {
    const response = await axios.post<{ recipient_id: string; message_id: string }>(
      `${FB_BASE_URL}/${pageId}/messages`,
      {
        recipient: { id: recipientPsid },
        message: { text },
        messaging_type: 'RESPONSE',
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

  // Display name of a person or Page by id (a Messenger sender, a post author). Ids are
  // numeric; validate before putting one in the URL.
  async getSenderName(pageAccessToken: string, psid: string): Promise<string | null> {
    if (!/^[0-9]{1,64}$/.test(psid)) return null;
    try {
      const response = await axios.get<{ name?: string }>(`${FB_BASE_URL}/${psid}`, {
        params: { fields: 'name' },
        ...bearer(pageAccessToken),
      });
      return response.data.name ?? null;
    } catch {
      return null;
    }
  },
};
