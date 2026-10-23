import { extractMessageContent, htmlToSlackMrkdwn, mapUserMentionIds } from '../../re-exports';
import { BaseTransformer } from '../../core/base/baseTransformer';
import type { ProviderConfig, ProviderMessage } from '../../core/types';
import type { SlackCredentials } from './types';

/** Slack ⇄ Spaces HTML: self-serve migration's converter in, desk's converter out. */
export class SlackTransformer extends BaseTransformer<SlackCredentials> {
  async toSpaces(
    message: ProviderMessage,
    config: ProviderConfig<SlackCredentials>
  ): Promise<string> {
    return await extractMessageContent(
      message.raw,
      !!message.botId,
      config.credentials.botToken,
      config.workspaceId
    );
  }

  // Someone with no Slack account stays as plain "@Name" text.
  toProvider(html: string, mentions: ReadonlyMap<string, string>): string {
    return htmlToSlackMrkdwn(mapUserMentionIds(html, (userId) => mentions.get(userId)));
  }
}
