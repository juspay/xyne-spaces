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

export abstract class BaseInteractionReplySender {
  readonly maxReplyLength?: number;

  abstract sendReply(context: InteractionReplyContext): Promise<NormalizedData>;
}
