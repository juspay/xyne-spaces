import https from 'node:https';
import { logger } from '@/utils/logger';

export class OzonetelError extends Error {}

/** What the Ozonetel APIs need from a connection's credentials. */
export interface OzonetelApiCredentials {
  apiKey: string;
  apiUser: string;
  baseUrl: string;
}

export function isAllowedOzonetelBaseUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && /(^|\.)ozonetel\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

// The API key goes in a header, so never send a request to a host that isn't Ozonetel's.
function assertAllowedBaseUrl(baseUrl: string): void {
  if (!isAllowedOzonetelBaseUrl(baseUrl)) {
    throw new OzonetelError('Ozonetel base URL must be an https ozonetel.com host');
  }
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

function getSubscribeBaseUrl(apiBaseUrl: string): string {
  const normalized = apiBaseUrl.toLowerCase();
  if (normalized.includes('ccaas.ozonetel.com') && !normalized.includes('in')) {
    return 'https://subscription.ccaas.ozonetel.com';
  }
  return 'https://subscription.ozonetel.com';
}

async function sendJsonGetWithBody(
  urlString: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  prepareText: (text: string) => string = text => text,
): Promise<{ status: number; data: unknown }> {
  const payload = JSON.stringify(body);
  const url = new URL(urlString);

  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(payload).toString(),
        },
        timeout: 30_000,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!text) {
            resolve({ status: res.statusCode ?? 0, data: null });
            return;
          }
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(prepareText(text)) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: text });
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new OzonetelError('Ozonetel request timed out')));
    req.write(payload);
    req.end();
  });
}

export const ozonetelService = {
  async subscribeEvents(
    credentials: OzonetelApiCredentials,
    callEventsURL: string,
  ): Promise<{ ok: true; message: string; subscribeBaseUrl: string }> {
    assertAllowedBaseUrl(credentials.baseUrl);

    const subscribeBaseUrl = getSubscribeBaseUrl(credentials.baseUrl);
    const res = await fetch(`${subscribeBaseUrl}/events/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_key: credentials.apiKey,
        username: credentials.apiUser,
      },
      body: JSON.stringify({ callEventsURL }),
    });

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      logger.error('[ozonetel] subscribe_api_error', {
        status: res.status,
        text,
        subscribeBaseUrl,
        host: hostOf(credentials.baseUrl),
      });
      throw new OzonetelError(`Ozonetel subscribe failed: ${res.status}`);
    }

    // callEventsURL carries the webhook secret, so it is not logged.
    logger.info('[ozonetel] subscribe_api_success', {
      subscribeBaseUrl,
      host: hostOf(credentials.baseUrl),
      responseText: text,
    });

    return {
      ok: true,
      message: text || 'Subscription added successfully',
      subscribeBaseUrl,
    };
  },

  async listAvailableCampaigns(
    credentials: OzonetelApiCredentials,
  ): Promise<{ ok: true; data: unknown; campaigns: string[] }> {
    assertAllowedBaseUrl(credentials.baseUrl);

    const result = await sendJsonGetWithBody(
      `${credentials.baseUrl}/ca_apis/getAvailableCampaigns`,
      {
        accept: 'application/json',
        apiKey: credentials.apiKey,
        'Content-Type': 'application/json',
      },
      {
        userName: credentials.apiUser,
      },
    );
    const data = result.data;
    if (result.status < 200 || result.status >= 300) {
      logger.error('[ozonetel] list_campaigns_api_error', {
        status: result.status,
        data,
        host: hostOf(credentials.baseUrl),
      });
      throw new OzonetelError(`Ozonetel campaigns list failed: ${result.status}`);
    }

    const campaigns = Array.from(
      new Set(
        extractCampaignNames(data).map(campaign => campaign.trim()).filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right));

    logger.info('[ozonetel] list_campaigns_api_success', {
      host: hostOf(credentials.baseUrl),
      campaignsCount: campaigns.length,
    });

    return {
      ok: true,
      data,
      campaigns,
    };
  },

  /** fromDate and toDate are IST "YYYY-MM-DD HH:MM:SS" on the same day, within the last 15 days. */
  async fetchCallDetails(
    credentials: OzonetelApiCredentials,
    {
      fromDate,
      toDate,
      campaignName,
    }: {
      fromDate: string;
      toDate: string;
      campaignName?: string;
    },
  ): Promise<Record<string, unknown>[]> {
    assertAllowedBaseUrl(credentials.baseUrl);

    const result = await sendJsonGetWithBody(
      `${credentials.baseUrl}/ca_reports/fetchCDRDetails`,
      {
        accept: 'application/json',
        apiKey: credentials.apiKey,
        'Content-Type': 'application/json',
      },
      { fromDate, toDate, userName: credentials.apiUser, ...(campaignName ? { campaignName } : {}) },
      // Call ids arrive as bare integers beyond 2^53; keep them as strings so they don't round.
      text => text.replace(/("(?:UCID|CallID|monitorUCID)"\s*:\s*)(\d+)/g, '$1"$2"'),
    );
    const data = result.data as { status?: unknown; message?: unknown; details?: unknown } | null;
    if (
      result.status < 200 ||
      result.status >= 300 ||
      !data ||
      typeof data !== 'object' ||
      data.status === 'error'
    ) {
      logger.error('[ozonetel] fetch_cdr_api_error', {
        status: result.status,
        data,
        host: hostOf(credentials.baseUrl),
        fromDate,
        toDate,
        campaignName,
      });
      throw new OzonetelError(
        `Ozonetel call details fetch failed: ${typeof data?.message === 'string' ? data.message : result.status}`,
      );
    }

    const details = Array.isArray(data?.details) ? data.details : [];
    logger.info('[ozonetel] fetch_cdr_api_success', {
      host: hostOf(credentials.baseUrl),
      fromDate,
      toDate,
      campaignName,
      count: details.length,
    });
    return details.filter(
      (row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row),
    );
  },
};

function extractCampaignNames(value: unknown): string[] {
  const names = new Set<string>();

  const visit = (node: unknown): void => {
    if (typeof node === 'string') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const record = node as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (
        typeof child === 'string' &&
        ['campaign', 'campaignname', 'campaign_name', 'name'].includes(key.toLowerCase())
      ) {
        names.add(child);
      }
      visit(child);
    }
  };

  visit(value);
  return Array.from(names);
}
