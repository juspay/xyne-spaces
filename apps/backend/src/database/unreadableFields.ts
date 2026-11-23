import type { Prisma } from '@prisma/client';

type Scalars<M extends Prisma.ModelName> = Prisma.TypeMap['model'][M]['payload']['scalars'];

/** The string fields of model `M`. */
type StringFieldOf<M extends Prisma.ModelName> = {
  [F in keyof Scalars<M>]: NonNullable<Scalars<M>[F]> extends string ? F : never;
}[keyof Scalars<M>] &
  string;

/**
 * Per Prisma model, the fields `unreadableDb` returns as `UnreadableString`: code can carry
 * them, it cannot read them without `reveal()`. The Prisma counterpart of the Zero list
 * (zero/unreadableColumns.ts); keep the two in step. A model or field name that is not in the
 * Prisma schema, or is not a string field, is a compile error here.
 */
export const UNREADABLE_FIELDS = {
  Canvas: ['title'],
  CanvasComment: ['body'],
  CanvasCommentThread: ['anchorText'],
  Channel: ['callSummaryPrompt'],
  ChannelUserStatus: ['customRecapPrompt'],
  COE: ['action'],
  Collection: ['description'],
  Dashboard: ['description'],
  DelayedMessage: ['content'],
  DraftMessage: ['content'],
  EmailChannelPreference: ['classificationPrompt', 'priorityClassificationPrompt'],
  EmailDraft: ['subject', 'draftContent'],
  EmailSignature: ['content'],
  Impact: ['impact'],
  Link: ['description'],
  Message: ['content'],
  MessageArtifact: ['messagePreview'],
  MessageAttachment: ['originalFilename'],
  RCA: ['title', 'summary', 'rootCause'],
  Role: ['description'],
  SdlcTrack: ['description'],
  SubTicket: ['title', 'description'],
  Ticket: ['description'],
  TicketDescription: ['description'],
  User: ['statusContent'],
  UserPresence: ['statusContent'],
  Workspace: ['description'],
} as const satisfies { readonly [M in Prisma.ModelName]?: readonly StringFieldOf<M>[] };

export type UnreadableModel = keyof typeof UNREADABLE_FIELDS;

/** The unreadable fields of model `M`; `never` for a model with none. */
export type UnreadableField<M> = M extends UnreadableModel ? (typeof UNREADABLE_FIELDS)[M][number] : never;

/** The unreadable fields of a model at runtime; empty for a model with none. */
export function unreadableFieldsOf(model: string | undefined): readonly string[] {
  if (!model) return [];
  return (UNREADABLE_FIELDS as Partial<Record<string, readonly string[]>>)[model] ?? [];
}
