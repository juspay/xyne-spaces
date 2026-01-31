import { ParseResult, PostprocessContext } from './types';

/**
 * Base class for data transformation
 * Transform platform-specific data to NormalizedData
 *
 * NOTE: No utility methods provided in base class
 * Implement any utility methods you need directly in your transformer
 */
export abstract class BaseTransformer<TRaw, TNormalized> {
  /**
   * Transform raw payload to normalized format
   *
   * @param rawPayload - Platform-specific payload
   * @returns ParseResult with normalized data or error
   */
  abstract transform(rawPayload: TRaw): Promise<ParseResult<TNormalized>>;

  /**
   * Optional: Postprocess after conversation/message creation
   * Implement this method for additional processing like creating tickets, triggering workflows, etc.
   *
   * @param context - Context with conversationId, messageId, and sourceId
   */
  postprocess?(context: PostprocessContext): Promise<void>;
}
