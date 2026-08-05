/**
 * Encrypted fields configuration — backend is the source of truth.
 *
 * Each table entry controls:
 *   - fields: which columns are encrypted at rest (ENC:v1|srv-...|...)
 *   - enforceClientEncryption: if true, backend rejects plaintext mutations for these fields
 *
 * Stages:
 *   Stage 8:  Add table with enforceClientEncryption: false → backend-only encryption
 *   Stage 9:  Set ZERO_ENC_CLIENT_ENCRYPTION_ENABLED=true → client encrypts too
 *   Stage 10: Set enforceClientEncryption: true → backend rejects plaintext
 */
export interface EncryptedTableConfig {
  fields: Set<string>;
  /** When true, mutations with plaintext values for these fields are rejected (Stage 10) */
  enforceClientEncryption: boolean;
}

export const encryptedFieldsConfig: Record<string, EncryptedTableConfig> = {
  messages: { fields: new Set(['content', 'link_preview_md']), enforceClientEncryption: true },
  conversations: {
    fields: new Set(['replies_md', 'initial_message_md', 'parent_message_md']),
    enforceClientEncryption: true,
  },
  // tickets: { fields: new Set(['title', 'description']), enforceClientEncryption: true }, has search issue, so no encryption enforced for now
  // emails: { fields: new Set(['subject', 'body']), enforceClientEncryption: true },
  // email_drafts: { fields: new Set(['draftContent']), enforceClientEncryption: true },
  // draft_messages: { fields: new Set(['content']), enforceClientEncryption: true },
  delayed_messages: { fields: new Set(['content']), enforceClientEncryption: true },
  scheduled_messages: { fields: new Set(['title', 'messageContent']), enforceClientEncryption: true },
};
