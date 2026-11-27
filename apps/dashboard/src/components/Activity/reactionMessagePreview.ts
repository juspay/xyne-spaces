import { parseForwardedMessageXml } from '@xyne/shared';
import {
  isUndecryptableMessage,
  UNDECRYPTABLE_MESSAGE_TEXT,
} from '../../utils/undecryptableMessage';

export const getReactionMessagePreview = (content: string): string => {
  if (isUndecryptableMessage(content)) return UNDECRYPTABLE_MESSAGE_TEXT;
  const forwardedMessage = parseForwardedMessageXml(content);
  if (!forwardedMessage) {
    return content;
  }

  return forwardedMessage.optionalText || forwardedMessage.content || 'Forwarded a message';
};
