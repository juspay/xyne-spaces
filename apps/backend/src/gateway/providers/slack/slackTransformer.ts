import { SlackBlockKitParser, htmlToSlackMrkdwn, resolveSlackMentions } from '../../re-exports';
import type { SlackAttachment } from '../../re-exports';
import { BaseTransformer } from '../../core/base/baseTransformer';
import type { ProviderConfig, ProviderMessage } from '../../core/types';
import type { SlackCredentials } from './types';

const SPAN_TAG = /<span[^<>]*>/g;
const USER_MENTION = /data-mention-type=["']user["']/;
const USER_ID = /data-user-id=(["'])([^"']+)\1/;

/** Slack text ⇄ Spaces HTML, with the same converters desk uses. */
export class SlackTransformer extends BaseTransformer<SlackCredentials> {
  private readonly blockKitParser = new SlackBlockKitParser();

  async toSpaces(
    message: ProviderMessage,
    config: ProviderConfig<SlackCredentials>
  ): Promise<string> {
    const { botToken } = config.credentials;
    const text = message.text
      ? await resolveSlackMentions(message.text, botToken, false, config.workspaceId)
      : '';
    const attachments = message.attachments?.length
      ? (JSON.parse(
          await resolveSlackMentions(
            JSON.stringify(message.attachments),
            botToken,
            true,
            config.workspaceId
          )
        ) as SlackAttachment[])
      : undefined;
    return this.blockKitParser.parse({ text, attachments });
  }

  toProvider(html: string, mentions: ReadonlyMap<string, string>): string {
    const withSlackIds = html.replace(SPAN_TAG, (tag) => {
      if (!USER_MENTION.test(tag)) return tag;
      const slackId = mentions.get(USER_ID.exec(tag)?.[2] ?? '');
      // Someone with no Slack account stays as plain "@Name" text.
      return slackId ? tag.replace(USER_ID, `data-user-id="${slackId}"`) : '<span>';
    });
    return htmlToSlackMrkdwn(withSlackIds);
  }
}
