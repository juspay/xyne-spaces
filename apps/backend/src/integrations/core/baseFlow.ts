/**
 * Base class for flow orchestration
 * Optional preprocessing (API calls, data enrichment)
 */
import { ExternalSource } from '@prisma/client';
import { TestPayloadResult } from './types';

export abstract class BaseFlow {
  /**
   * Optional: Preprocess payload before transformation
   * Use this to fetch additional data via API calls or enrich the payload
   *
   * @param rawPayload - Raw payload from external source
   * @param _source - External source object from database (optional)
   * @returns Enriched payload (can be same as input if no preprocessing needed)
   */
  async preprocess?(rawPayload: any, _source?: ExternalSource): Promise<any> {
    return rawPayload; // Default: no preprocessing
  }

  /**
   * Optional: Dynamically determine source name for database lookup
   * Useful for routing different sub-sources to different configurations
   *
   * @param payload - Parsed payload object from external source
   * @returns Source name to use, or undefined to use the default from route
   *
   * @example
   * // Route different Slack workspaces to different sources
   * getSourceNameFromDB(payload) {
   *   const teamId = payload.team_id;
   *   return teamId === 'T123' ? 'slack-workspace-a' : 'slack-workspace-b';
   * }
   */
  getSourceNameFromDB?(_payload: any): string | undefined {
    return undefined; // Default: use source name from route
  }

  /**
   * Optional: Check if the payload is a test payload
   * Useful for skipping processing of test webhooks
   *
   * @param payload - Parsed payload object from external source
   * @returns TestPayloadResult with isTest flag and optional response to send
   *
   * @example
   * // Check if Slack event is a test event
   * isTestPayload(payload: any): TestPayloadResult {
   *   if (payload?.event?.type === 'test') {
   *     return {
   *       isTest: true,
   *       response: {
   *         status: 200,
   *         body: { success: true, skipped: true, reason: 'test_webhook' }
   *       }
   *     };
   *   }
   *   return { isTest: false };
   * }
   */
  isTestPayload?(_payload: any): TestPayloadResult {
    return { isTest: false }; // Default: not a test payload
  }

  /**
   * Optional: Handle webhook verification via query params
   * Runs before source DB lookup — source may not exist yet during subscription setup.
   */
  isTestQueryParam?(_query: Record<string, string | undefined>): TestPayloadResult {
    return { isTest: false };
  }
}
