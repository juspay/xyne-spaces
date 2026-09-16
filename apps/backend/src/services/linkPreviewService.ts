import axios, { AxiosResponse } from 'axios';
import { parse } from 'node-html-parser';
import {logger} from '@/utils/logger';
import { resolveExternalHostPinned, pinnedAgentsFor } from '@/utils/ssrfGuard';
import { config } from '@/config/env';

export interface ExternalLinkMetadata {
  type?: 'external';
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  favicon?: string;
}

export interface InternalLinkAttachment {
  id: string;
  entityType: string;
  entityId: string;
  storageProvider: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  width?: number | null;
  height?: number | null;
  uploadedByUserId: string;
  createdAt: number;
  url: string;
  createdBy: string;
  metadata?: Record<string, unknown> | null;
  conversationId?: string | null;
  thumbnailUrl?: string | null;
}

export interface InternalMessageLinkMetadata {
  type: 'internal_message';
  url: string;
  messageId: string;
  channelId: string;
  channelName: string;
  channelScopeType?: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  timestamp: string;
  replyCount?: number;
  isDeleted?: boolean;
  hasAttachment?: boolean;
  attachments?: InternalLinkAttachment[];
  /** The original message's own link preview (if it had one) */
  nestedLinkPreview?: Record<string, unknown>;
  /** Ticket data if the linked conversation has an associated ticket */
  ticket?: Record<string, unknown>;
}

export type LinkMetadata = ExternalLinkMetadata | InternalMessageLinkMetadata;

/**
 * LinkPreviewService
 *
 * Fetches and extracts metadata from URLs for link previews
 * Supports Open Graph, Twitter Cards, and standard meta tags
 */
export class LinkPreviewService {
  private readonly USER_AGENT =
    'Mozilla/5.0 (compatible; XyneBot/1.0; +https://xyne.ai)';
  private readonly TIMEOUT = 10000; // 10 seconds
  private readonly MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5MB

  /**
   * Fetches link metadata from a URL
   */
  async fetchMetadata(url: string): Promise<LinkMetadata> {
    try {
      // Validate URL
      new URL(url);

      // Fetch the page (SSRF-guarded — blocks internal/metadata targets and
      // re-validates every redirect hop).
      const response = await this.safeGet(url);

      const html = response.data;
      const root = parse(html);

      // Extract metadata
      const metadata: LinkMetadata = {
        url,
        title: this.extractTitle(root, url),
        description: this.extractDescription(root),
        siteName: this.extractSiteName(root, url),
        image: this.extractImage(root, url),
        favicon: this.extractFavicon(root, url),
      };

      return metadata;
    } catch (error: any) {
      logger.error(`Failed to fetch link preview for ${url}:`, error.message);

      // Return minimal metadata on error
      return {
        url,
        title: this.extractDomainName(url),
        siteName: this.extractDomainName(url),
      };
    }
  }

  /**
   * SSRF-safe GET. Validates the scheme and host of the initial URL and of
   * every redirect target against the shared SSRF guard (blocks loopback,
   * RFC1918, link-local/metadata 169.254.0.0/16, *.svc.cluster.local, etc.),
   * following redirects manually so each hop is re-checked. Link previews have
   * no legitimate internal target, so internal hosts are always refused.
   *
   * DATA_SOURCE_ALLOW_PRIVATE_HOSTS is honoured only in local development — it
   * exists for dashboard data-source connectors, not link previews, and reading it
   * unqualified would disable this guard wherever a connector needs it. Mirrors
   * assertWebhookUrlSafe.
   */
  private async safeGet(initialUrl: string): Promise<AxiosResponse> {
    const MAX_REDIRECTS = 5;
    let currentUrl = initialUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(currentUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Blocked non-http(s) scheme: ${parsed.protocol}`);
      }
      const allowPrivate = config.dataSource.allowPrivateHosts && config.env === 'development';
      const pinned = await resolveExternalHostPinned(parsed.hostname, allowPrivate);

      const response = await axios.get(currentUrl, {
        headers: {
          'User-Agent': this.USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        timeout: this.TIMEOUT,
        maxContentLength: this.MAX_CONTENT_LENGTH,
        maxRedirects: 0, // follow manually so each hop is re-validated above
        validateStatus: (status) => status >= 200 && status < 400,
        // Connect to the validated addresses rather than re-resolving the name.
        ...(pinned ? pinnedAgentsFor(parsed.hostname, pinned) : {}),
      });

      // Not a redirect → this is the final response.
      const location = response.headers['location'];
      if (response.status < 300 || response.status >= 400 || !location) {
        return response;
      }

      // Resolve the (possibly relative) redirect target and loop to re-check it.
      currentUrl = new URL(location, currentUrl).toString();
    }

    throw new Error(`Too many redirects (> ${MAX_REDIRECTS})`);
  }

  /**
   * Extracts title from Open Graph, Twitter, or <title> tag
   */
  private extractTitle(root: any, url: string): string {
    // Try Open Graph
    const ogTitle = root
      .querySelector('meta[property="og:title"]')
      ?.getAttribute('content');
    if (ogTitle) return ogTitle;

    // Try Twitter Card
    const twitterTitle = root
      .querySelector('meta[name="twitter:title"]')
      ?.getAttribute('content');
    if (twitterTitle) return twitterTitle;

    // Try <title> tag
    const titleTag = root.querySelector('title')?.rawText;
    if (titleTag) return titleTag.trim();

    // Fallback to domain name
    return this.extractDomainName(url);
  }

  /**
   * Extracts description from meta tags
   */
  private extractDescription(root: any): string | undefined {
    // Try Open Graph
    const ogDesc = root
      .querySelector('meta[property="og:description"]')
      ?.getAttribute('content');
    if (ogDesc) return ogDesc;

    // Try Twitter Card
    const twitterDesc = root
      .querySelector('meta[name="twitter:description"]')
      ?.getAttribute('content');
    if (twitterDesc) return twitterDesc;

    // Try standard meta description
    const metaDesc = root
      .querySelector('meta[name="description"]')
      ?.getAttribute('content');
    if (metaDesc) return metaDesc;

    return undefined;
  }

  /**
   * Extracts site name from Open Graph or URL
   */
  private extractSiteName(root: any, url: string): string {
    // Try Open Graph
    const ogSiteName = root
      .querySelector('meta[property="og:site_name"]')
      ?.getAttribute('content');
    if (ogSiteName) return ogSiteName;

    // Fallback to domain name
    return this.extractDomainName(url);
  }

  /**
   * Extracts preview image from Open Graph or Twitter Card
   */
  private extractImage(root: any, url: string): string | undefined {
    // Try Open Graph (most common)
    const ogImage = root
      .querySelector('meta[property="og:image"]')
      ?.getAttribute('content');
    if (ogImage && ogImage.trim()) {
      return this.resolveUrl(ogImage.trim(), url);
    }

    // Try og:image:secure_url (HTTPS version)
    const ogImageSecure = root
      .querySelector('meta[property="og:image:secure_url"]')
      ?.getAttribute('content');
    if (ogImageSecure && ogImageSecure.trim()) {
      return this.resolveUrl(ogImageSecure.trim(), url);
    }

    // Try Twitter Card large image
    const twitterImageLarge = root
      .querySelector('meta[name="twitter:image"]')
      ?.getAttribute('content');
    if (twitterImageLarge && twitterImageLarge.trim()) {
      return this.resolveUrl(twitterImageLarge.trim(), url);
    }

    // Try twitter:image:src (alternative)
    const twitterImageSrc = root
      .querySelector('meta[name="twitter:image:src"]')
      ?.getAttribute('content');
    if (twitterImageSrc && twitterImageSrc.trim()) {
      return this.resolveUrl(twitterImageSrc.trim(), url);
    }

    // Try finding first large image in the page as fallback
    const firstImg = root.querySelector('img[src]');
    if (firstImg) {
      const imgSrc = firstImg.getAttribute('src');
      if (imgSrc && imgSrc.trim()) {
        return this.resolveUrl(imgSrc.trim(), url);
      }
    }

    return undefined;
  }

  /**
   * Extracts favicon URL
   */
  private extractFavicon(root: any, url: string): string | undefined {
    // Try various favicon link tags
    const selectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
    ];

    for (const selector of selectors) {
      const favicon = root.querySelector(selector)?.getAttribute('href');
      if (favicon) {
        return this.resolveUrl(favicon, url);
      }
    }

    // Fallback to default /favicon.ico
    try {
      const parsedUrl = new URL(url);
      return `${parsedUrl.protocol}//${parsedUrl.host}/favicon.ico`;
    } catch {
      return undefined;
    }
  }

  /**
   * Extracts domain name from URL
   */
  private extractDomainName(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /**
   * Resolves relative URLs to absolute URLs
   */
  private resolveUrl(relativeUrl: string, baseUrl: string): string {
    try {
      // If already absolute, return as-is
      if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
        return relativeUrl;
      }

      // Resolve relative URL
      const base = new URL(baseUrl);
      const resolved = new URL(relativeUrl, base);
      return resolved.toString();
    } catch {
      return relativeUrl;
    }
  }
}

export const linkPreviewService = new LinkPreviewService();
