import { ExternalSourceAdapter, ExternalSourcePlatform } from './types';
import { logger } from '../../utils/logger';

/**
 * Adapter Registry
 * Centralized registry for all external source adapters
 */
class AdapterRegistry {
  private adapters = new Map<ExternalSourcePlatform, ExternalSourceAdapter>();

  /**
   * Register an adapter for a platform
   *
   * @param platform - Platform enum value
   * @param adapter - Adapter implementation
   */
  register(platform: ExternalSourcePlatform, adapter: ExternalSourceAdapter): void {
    this.adapters.set(platform, adapter);
    logger.info(`Registered adapter: ${platform}`);
  }

  /**
   * Get adapter for a sourceName
   * Extracts platform from sourceName (e.g., "zoho-euler" → "zoho")
   *
   * @param sourceName - Source name (e.g., "zoho-euler", "slack-eng")
   * @returns Adapter for the platform
   * @throws Error if no adapter found
   */
  getAdapter(sourceName: string): ExternalSourceAdapter {
    const platform = this.extractPlatform(sourceName);

    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`No adapter registered for platform: ${platform}`);
    }

    return adapter;
  }

  /**
   * Check if adapter exists for a sourceName
   *
   * @param sourceName - Source name to check
   * @returns true if adapter exists
   */
  hasAdapter(sourceName: string): boolean {
    const platform = this.extractPlatform(sourceName);
    return this.adapters.has(platform);
  }

  /**
   * Extract platform name from sourceName and map to enum
   * Examples: "zoho-euler" → ExternalSourcePlatform.ZOHO, "slack-eng" → ExternalSourcePlatform.SLACK,
   * "slack-desk-C123" → ExternalSourcePlatform.SLACK_DESK
   *
   * Tries two-segment platform names first to support compound platforms like "slack-desk".
   *
   * @param sourceName - Full source name
   * @returns Platform enum value
   * @throws Error if platform not recognized
   */
  private extractPlatform(sourceName: string): ExternalSourcePlatform {
    const parts = sourceName.split('-');
    // Try two-segment platform first (e.g., "slack-desk" or "slack-desk-C123")
    if (parts.length >= 2) {
      const twoSegment = `${parts[0]}-${parts[1]}`.toLowerCase();
      const platform = this.tryMapStringToPlatform(twoSegment);
      if (platform) return platform;
    }
    const platformStr = parts[0].toLowerCase();
    return this.mapStringToPlatform(platformStr);
  }

  /**
   * Map string to platform enum
   *
   * @param platformStr - Platform string (e.g., "zoho", "slack")
   * @returns Platform enum value
   * @throws Error if platform not recognized
   */
  private static readonly PLATFORM_MAPPING: Record<string, ExternalSourcePlatform> = {
    zoho: ExternalSourcePlatform.ZOHO,
    slack: ExternalSourcePlatform.SLACK,
    'slack-desk': ExternalSourcePlatform.SLACK_DESK,
    microsoft: ExternalSourcePlatform.MICROSOFT,
    google: ExternalSourcePlatform.GOOGLE,
  };

  private tryMapStringToPlatform(platformStr: string): ExternalSourcePlatform | undefined {
    return AdapterRegistry.PLATFORM_MAPPING[platformStr];
  }

  private mapStringToPlatform(platformStr: string): ExternalSourcePlatform {
    const platform = this.tryMapStringToPlatform(platformStr);
    if (!platform) {
      throw new Error(`Unknown platform: ${platformStr}`);
    }
    return platform;
  }
}

// Export singleton
export const adapterRegistry = new AdapterRegistry();
