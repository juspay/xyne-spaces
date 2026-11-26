import type { Schema } from '@xyne/shared';

type Tables = Schema['tables'];
type ColumnOf<T extends keyof Tables> = Extract<keyof Tables[T]['columns'], string>;

/**
 * Per Zero table, the columns a mutator defined with defineContractMutator reads as
 * `UnreadableString`: it can carry them, it cannot read them. A table or column name that is
 * not in the Zero schema is a compile error here. Every other column passes through.
 */
export const UNREADABLE_COLUMNS = {
  canvas_comment_threads: ['anchorText'],
  canvas_comments: ['body'],
  canvases: ['title'],
  channel_user_status: ['customRecapPrompt'],
  channels: ['callSummaryPrompt'],
  coes: ['action'],
  collections: ['description'],
  conversations: ['initial_message_md', 'parent_message_md', 'replies_md'],
  dashboards: ['description'],
  delayed_messages: ['content'],
  draft_messages: ['content'],
  email_drafts: ['subject', 'draftContent'],
  email_channel_preferences: ['classificationPrompt', 'priorityClassificationPrompt'],
  email_signatures: ['content'],
  impacts: ['impact'],
  links: ['description'],
  message_artifacts: ['messagePreview'],
  message_attachments: ['originalFilename'],
  messages: ['content', 'link_preview_md'],
  rcas: ['title', 'summary', 'rootCause'],
  roles: ['description'],
  sdlc_tracks: ['description'],
  sub_tickets: ['title', 'description'],
  ticket_descriptions: ['description'],
  tickets: ['description'],
  user_presence: ['statusContent'],
  users: ['statusContent'],
  workspaces: ['description'],
} as const satisfies { readonly [T in keyof Tables]?: readonly ColumnOf<T>[] };

/** The unreadable columns of table `T`; `never` for a table with none. */
export type UnreadableColumn<T> = T extends keyof typeof UNREADABLE_COLUMNS
  ? (typeof UNREADABLE_COLUMNS)[T][number]
  : never;

/** The unreadable columns of a table at runtime; empty for a table with none. */
export function unreadableColumnsOf(table: string): readonly string[] {
  return (UNREADABLE_COLUMNS as Partial<Record<string, readonly string[]>>)[table] ?? [];
}
