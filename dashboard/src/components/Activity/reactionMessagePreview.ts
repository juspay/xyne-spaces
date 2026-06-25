import { parseForwardedMessageXml } from '@xyne/shared';

export const getReactionMessagePreview = (content: string): string => {
  const forwardedMessage = parseForwardedMessageXml(content);
  if (!forwardedMessage) {
    return content;
  }

  return forwardedMessage.optionalText || forwardedMessage.content || 'Forwarded a message';
};
