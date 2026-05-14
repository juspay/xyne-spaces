import { config } from '@/config/env';

export interface ConfluenceClientConfig {
  baseUrl: string;
  email?: string;
  apiToken?: string;
  bearerToken?: string;
}

interface ConfluenceLinks {
  webui?: string;
  download?: string;
  base?: string;
}

export interface ConfluenceUser {
  accountId?: string;
  accountType?: string;
  email?: string;
  emailAddress?: string;
  displayName?: string;
  publicName?: string;
  username?: string;
  userKey?: string;
  _links?: ConfluenceLinks;
}

export interface ConfluenceSpace {
  id?: number | string;
  key: string;
  name: string;
  type?: string;
  _links?: ConfluenceLinks;
}

export interface ConfluencePage {
  id: string;
  type: string;
  status?: string;
  title: string;
  version?: { number?: number; when?: string };
  history?: {
    createdDate?: string;
    createdBy?: ConfluenceUser;
    lastUpdated?: {
      when?: string;
      by?: ConfluenceUser;
    };
  };
  ancestors?: Array<{ id: string; title: string }>;
  body?: {
    storage?: {
      value?: string;
      representation?: string;
    };
    view?: {
      value?: string;
      representation?: string;
    };
  };
  _links?: ConfluenceLinks;
}

export interface ConfluenceAttachment {
  id: string;
  title: string;
  mediaType?: string;
  fileSize?: number;
  version?: { number?: number; when?: string };
  _links?: ConfluenceLinks;
}

interface ConfluenceRestrictionSubjectPage<T> {
  results?: T[];
  start?: number;
  limit?: number;
  size?: number;
}

interface ConfluenceRestrictionOperation {
  operation: 'read' | 'update';
  restrictions?: {
    user?: ConfluenceRestrictionSubjectPage<ConfluenceUser>;
    group?: ConfluenceRestrictionSubjectPage<{ id?: string; name?: string; type?: string }>;
  };
}

export interface ConfluenceContentRestrictions {
  read?: ConfluenceRestrictionOperation;
  update?: ConfluenceRestrictionOperation;
  _links?: ConfluenceLinks;
}

interface ConfluencePageResponse<T> {
  results: T[];
  start?: number;
  limit?: number;
  size?: number;
  _links?: {
    next?: string;
  };
}

export class ConfluenceClient {
  private readonly baseUrl: string;

  constructor(private readonly config: ConfluenceClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  static fromEnv(): ConfluenceClient {
    const baseUrl = config.confluence.baseUrl;
    if (!baseUrl) {
      throw new Error('CONFLUENCE_BASE_URL is required');
    }

    return new ConfluenceClient({
      baseUrl,
      email: config.confluence.email,
      apiToken: config.confluence.apiToken,
      bearerToken: config.confluence.authToken,
    });
  }

  async getSpace(spaceKey: string): Promise<ConfluenceSpace> {
    return this.fetchJson<ConfluenceSpace>(`/wiki/rest/api/space/${encodeURIComponent(spaceKey)}`);
  }

  async fetchAllPages(spaceKey: string): Promise<ConfluencePage[]> {
    const pages: ConfluencePage[] = [];
    let start = 0;
    const limit = 100;

    for (;;) {
      const url =
        `/wiki/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}` +
        `&type=page&status=current&limit=${limit}&start=${start}` +
        '&expand=body.storage,body.view,ancestors,version,history,_links';
      const page = await this.fetchJson<ConfluencePageResponse<ConfluencePage>>(url);
      pages.push(...page.results);

      if (!page._links?.next || page.results.length === 0) {
        break;
      }

      start += page.results.length;
    }

    return pages;
  }

  async fetchAttachments(pageId: string): Promise<ConfluenceAttachment[]> {
    const attachments: ConfluenceAttachment[] = [];
    let start = 0;
    const limit = 100;

    for (;;) {
      const url =
        `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment` +
        `?limit=${limit}&start=${start}&expand=version,_links`;
      const page = await this.fetchJson<ConfluencePageResponse<ConfluenceAttachment>>(url);
      attachments.push(...page.results);

      if (!page._links?.next || page.results.length === 0) {
        break;
      }

      start += page.results.length;
    }

    return attachments;
  }

  async fetchContentRestrictions(contentId: string): Promise<ConfluenceContentRestrictions> {
    return this.fetchJson<ConfluenceContentRestrictions>(
      `/wiki/rest/api/content/${encodeURIComponent(contentId)}/restriction/byOperation`,
    );
  }

  async downloadAttachment(pageId: string, attachment: ConfluenceAttachment): Promise<{
    buffer: Buffer;
    contentType: string;
    filename: string;
  }> {
    const response = await this.fetchRaw(
      `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment/${encodeURIComponent(attachment.id)}/download`,
      { headers: { Accept: '*/*' } },
    );
    if (!response.ok) {
      throw new Error(`Failed to download Confluence attachment ${attachment.id}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type') || attachment.mediaType || 'application/octet-stream',
      filename: attachment.title,
    };
  }

  getWebUrl(link?: string): string | undefined {
    if (!link) return undefined;
    return this.resolveUrl(link);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async fetchJson<T>(pathOrUrl: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchRaw(pathOrUrl, init);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Confluence request failed: ${response.status} ${response.statusText} ${body}`);
    }

    return response.json() as Promise<T>;
  }

  private fetchRaw(pathOrUrl: string, init?: RequestInit): Promise<Response> {
    return fetch(this.resolveUrl(pathOrUrl), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...this.buildAuthHeaders(),
        ...(init?.headers || {}),
      },
    });
  }

  private buildAuthHeaders(): Record<string, string> {
    if (this.config.bearerToken) {
      return { Authorization: `Bearer ${this.config.bearerToken}` };
    }

    if (this.config.email && this.config.apiToken) {
      return {
        Authorization: `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')}`,
      };
    }

    throw new Error('Set CONFLUENCE_AUTH_TOKEN or both CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN');
  }

  private resolveUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }

    const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${this.baseUrl}${path}`;
  }
}
