import type { ExternalSource } from '@prisma/client';
import type { NormalizedData } from './types';

export interface InteractionReplyContext {
  source: ExternalSource;
  externalThreadId: string;
  subject: string;
  body: string;
  userId: string;
  authorName: string;
}

export class InteractionReplyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractionReplyValidationError';
  }
}

export abstract class BaseInteractionReplySender {
  abstract sendReply(context: InteractionReplyContext): Promise<NormalizedData>;
}
