import { BasePostprocessor } from '../../core/basePostprocessor';
import { PostprocessContext } from '../../core/types';

export class SlackDeskPostprocessor extends BasePostprocessor {
  async process(_context: PostprocessContext): Promise<void> {
    // Intentionally empty — no reply back to Slack on ingestion.
  }
}
