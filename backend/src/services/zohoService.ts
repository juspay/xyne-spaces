/**
 * Zoho Desk Service
 * Sends email replies via Zoho API with sourceId to prevent webhook loops
 */

import axios, { AxiosInstance } from 'axios';
import { decrypt } from './encryptionService';
import { logger } from '@/utils/logger';

interface ZohoCredentials {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  orgId: string;
}

interface SendReplyParams {
  ticketId: string;
  content: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  fromEmailAddress: string;
}

interface SendReplyResponse {
  threadId: string;
}

// Module-level cache survives across instances since fromEncryptedCredentials creates a new ZohoService per request
const tokenCache = new Map<string, { token: string; expiresAt: Date }>();

export class ZohoService {
  private client: AxiosInstance;
  private credentials: ZohoCredentials;

  constructor(
    credentials: ZohoCredentials,
    private sourceId: string
  ) {
    this.credentials = credentials;
    this.client = axios.create({
      baseURL: 'https://desk.zoho.com/api/v1',
      headers: {
        'Content-Type': 'application/json',
        'orgId': credentials.orgId,
        'sourceId': sourceId, // Prevents webhook loop
      },
    });
  }

  /**
   * Exchange refresh token for access token
   */
  private async getAccessToken(scope: string = 'Desk.tickets.UPDATE'): Promise<string> {
    const cacheKey = `${this.sourceId}:${scope}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && new Date() < cached.expiresAt) {
      logger.info('[ZohoService] Using cached access token');
      return cached.token;
    }

    try {
      logger.info('[ZohoService] Exchanging refresh token for access token');
      
      const params = new URLSearchParams();
      params.append('refresh_token', this.credentials.refreshToken);
      params.append('client_id', this.credentials.clientId);
      params.append('client_secret', this.credentials.clientSecret);
      params.append('grant_type', 'refresh_token');
      params.append('scope', scope);

      const response = await axios.post(
        'https://accounts.zoho.com/oauth/v2/token',
        params,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const token: string = response.data.access_token;
      const expiresIn: number = response.data.expires_in ?? 3600;
      tokenCache.set(cacheKey, { token, expiresAt: new Date(Date.now() + (expiresIn - 300) * 1000) });

      logger.info('[ZohoService] Access token obtained successfully');
      return token;
    } catch (error) {
      logger.error('[ZohoService] Failed to get access token', { error });
      throw new Error('Failed to refresh Zoho access token');
    }
  }

  /**
   * Create ZohoService from encrypted credentials
   */
  static fromEncryptedCredentials(
    encryptedCredentials: string,
    sourceId: string
  ): ZohoService {
    const decrypted = decrypt(encryptedCredentials);
    const credentials = JSON.parse(decrypted) as ZohoCredentials;
    return new ZohoService(credentials, sourceId);
  }

  /**
   * Send email reply via Zoho API
   */
  async sendReply(params: SendReplyParams): Promise<SendReplyResponse> {
    const { ticketId, content, to, cc = [], bcc = [], fromEmailAddress } = params;

    logger.info(`[ZohoService] Sending reply to ticket ${ticketId} with sourceId: ${this.sourceId}`);

    // Get fresh access token
    const accessToken = await this.getAccessToken();

    const payload: any = {
      channel: 'EMAIL',
      content,
      contentType: 'html',
      fromEmailAddress,
      to: to.join(','),
    };

    if (cc.length > 0) {
      payload.cc = cc.join(',');
    }

    if (bcc.length > 0) {
      payload.bcc = bcc.join(',');
    }

    const response = await this.client.post(`/tickets/${ticketId}/sendReply`, payload, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
      },
    });

    logger.info(`[ZohoService] Reply sent. Thread ID: ${response.data.id}`);

    return {
      threadId: response.data.id,
    };
  }

  /**
   * Get thread details from Zoho API
   */
  async getThreadDetails(ticketId: string, threadId: string): Promise<any> {
    logger.info(`[ZohoService] Fetching thread details for ticket ${ticketId}, thread ${threadId}`);

    // Get fresh access token with READ scope
    const accessToken = await this.getAccessToken('Desk.tickets.READ');

    const response = await this.client.get(`/tickets/${ticketId}/threads/${threadId}`, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        include: 'plainText',
      },
    });

    logger.info(`[ZohoService] Thread details fetched successfully`);
    return response.data;
  }
}
