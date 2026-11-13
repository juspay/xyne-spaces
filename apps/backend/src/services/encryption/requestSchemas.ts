// Declarative request-body shapes per API, so the backend can validate field types
// for client-encrypted requests without reading the values. This only describes
// field TYPES; which fields are encrypted (and how) is owned by the encryption
// service, not this file.

export type FieldType = 'int' | 'float' | 'string' | 'boolean' | 'object' | 'array';

export interface RequestSchema {
  // Keys are field paths: dot notation for nesting, `[]` for array items (e.g. `attachments[].url`).
  fields: Record<string, FieldType>;
}

// Keyed by "<METHOD> <path>", path as mounted under /api (without the prefix), with `:param` segments.
export const REQUEST_SCHEMAS: Record<string, RequestSchema> = {
  // ConversationController.replyToConversation (multipart; `files`/`thumbnails` are file parts, not body fields)
  'POST /conversations/:conversationId/messages': {
    fields: {
      content: 'string',
      msgType: 'string', // MessageType enum value
      visibleTo: 'string', // nullable
      fileMetadata: 'string', // JSON-encoded array, parsed server-side by fileMetadataSchema
      showInChannel: 'boolean', // also accepted as the string 'true' from multipart forms
    },
  },
};

export function getRequestSchema(method: string, path: string): RequestSchema | undefined {
  return REQUEST_SCHEMAS[`${method.toUpperCase()} ${path}`];
}
