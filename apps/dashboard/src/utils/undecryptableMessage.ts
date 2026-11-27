import { isCiphertextValue } from '@xyne/shared';

export const UNDECRYPTABLE_MESSAGE_TEXT = "Couldn't display this message";

/** Message text that reached the UI still encrypted: this client could not decrypt it. */
export const isUndecryptableMessage = (content: unknown): boolean => isCiphertextValue(content);
