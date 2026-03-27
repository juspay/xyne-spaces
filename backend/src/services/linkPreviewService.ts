import axios from 'axios';
import { parse } from 'node-html-parser';
import {logger} from '@/utils/logger';

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

      // Fetch the page
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        timeout: this.TIMEOUT,
        maxContentLength: this.MAX_CONTENT_LENGTH,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
      });

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
