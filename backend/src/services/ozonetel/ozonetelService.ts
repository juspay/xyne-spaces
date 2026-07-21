import https from 'node:https';
import { logger } from '@/utils/logger';
import { ozonetelConfigService } from './ozonetelConfigService';

export class OzonetelError extends Error {}

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
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: text });
          }
        });
      },
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export const ozonetelService = {
  async subscribeEvents({
    workspaceId,
    callEventsURL,
  }: {
    workspaceId: string;
    callEventsURL: string;
  }): Promise<{ ok: true; message: string; subscribeBaseUrl: string }> {
    const cfg = await ozonetelConfigService.getConfig(workspaceId);
    if (!cfg) throw new OzonetelError('Ozonetel not configured for workspace');

    const subscribeBaseUrl = getSubscribeBaseUrl(cfg.baseUrl);
    const res = await fetch(`${subscribeBaseUrl}/events/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_key: cfg.apiKey,
        username: cfg.apiUser,
      },
      body: JSON.stringify({ callEventsURL }),
    });

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      logger.error('[ozonetel] subscribe_api_error', {
        status: res.status,
        text,
        subscribeBaseUrl,
        workspaceId,
      });
      throw new OzonetelError(`Ozonetel subscribe failed: ${res.status}`);
    }

    logger.info('[ozonetel] subscribe_api_success', {
      workspaceId,
      subscribeBaseUrl,
      callEventsURL,
      responseText: text,
    });

    return {
      ok: true,
      message: text || 'Subscription added successfully',
      subscribeBaseUrl,
    };
  },

  async listAvailableCampaigns({
    workspaceId,
  }: {
    workspaceId: string;
  }): Promise<{ ok: true; data: unknown; campaigns: string[] }> {
    const cfg = await ozonetelConfigService.getConfig(workspaceId);
    if (!cfg) throw new OzonetelError('Ozonetel not configured for workspace');

    const result = await sendJsonGetWithBody(
      `${cfg.baseUrl}/ca_apis/getAvailableCampaigns`,
      {
        accept: 'application/json',
        apiKey: cfg.apiKey,
        'Content-Type': 'application/json',
      },
      {
        userName: cfg.apiUser,
      },
    );
    const data = result.data;
    if (result.status < 200 || result.status >= 300) {
      logger.error('[ozonetel] list_campaigns_api_error', {
        status: result.status,
        data,
        workspaceId,
      });
      throw new OzonetelError(`Ozonetel campaigns list failed: ${result.status}`);
    }

    const campaigns = Array.from(
      new Set(
        extractCampaignNames(data).map(campaign => campaign.trim()).filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right));

    logger.info('[ozonetel] list_campaigns_api_success', {
      workspaceId,
      campaignsCount: campaigns.length,
    });

    return {
      ok: true,
      data,
      campaigns,
    };
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
