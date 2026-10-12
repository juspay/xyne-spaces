import { parseForwardedMessageXml } from '@xyne/shared';

// Nullable by contract. `parseForwardedMessageXml` already tolerates a nullish
// argument, so this does not guard against a throw — it stops the declared
// `: string` return from being a lie, since the non-forwarded branch returns
// `content` straight back to callers that index into it.
export const getReactionMessagePreview = (content: string | null | undefined): string => {
  if (typeof content !== 'string') return '';
  const forwardedMessage = parseForwardedMessageXml(content);
  if (!forwardedMessage) {
    return content;
  }

  return forwardedMessage.optionalText || forwardedMessage.content || 'Forwarded a message';
};
