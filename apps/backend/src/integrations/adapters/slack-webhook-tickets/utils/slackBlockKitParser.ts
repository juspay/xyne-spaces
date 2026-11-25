/**
 * Slack Block Kit to HTML parser. The code lives in @xyne/shared (src/slack/blockKitParser.ts) so
 * the encryption extractor can run the same conversion on decrypted content; this is that parser,
 * reporting to the backend logger.
 */
import { SlackBlockKitParser as SharedSlackBlockKitParser } from '@xyne/shared';
import { logger } from '../../../../utils/logger';

export class SlackBlockKitParser extends SharedSlackBlockKitParser {
  constructor() {
    super({ warn: (message) => logger.warn(message) });
  }
}
