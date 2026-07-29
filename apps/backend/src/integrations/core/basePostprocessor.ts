import { PostprocessContext } from './types';

/**
 * Base class for postprocessing
 * Optional hook that runs after conversation/message creation
 * Use this for adapter-specific actions like ticket creation, workflow triggers, etc.
 */
export abstract class BasePostprocessor {
  /**
   * Process after conversation/message creation
   *
   * @param context - Postprocess context with conversation/message details
   * @returns Promise that resolves when postprocessing is complete
   */
  abstract process(context: PostprocessContext): Promise<void>;
}
