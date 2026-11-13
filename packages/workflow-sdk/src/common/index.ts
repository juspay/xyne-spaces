/**
 * @xyne/workflow-sdk/common — browser-safe shared primitives.
 *
 * Everything exported from this module is guaranteed to be importable in
 * non-Node environments (browsers, edge runtimes). It contains types and
 * pure utilities that travel across the framework boundary:
 *
 * - {@link Attachment} — opaque file reference produced by the storage layer
 * - {@link CitationRef} — runtime, agent-emitted provenance for one data point
 * - {@link ResumePayload} / {@link ResumeAttachment} / {@link ResumeAction} — pause/resume contract
 * - {@link isExecutable}, {@link extensionOf} — upload safety check used at both perimeter and UI
 * - Credential vault schemas, types, and the minimal auth-type registry —
 *   shared between the server (SDK router + persistence), the workflow-ui
 *   credential dropdown, and the xyne-search frontend credential management
 *   page. All of these imports are browser-safe (only `zod` is required).
 *
 * The main `@xyne/workflow-sdk` barrel still re-exports these for
 * server-side use; UI / builder code should import from here so that
 * Node-only modules (persistence runtimes, DNS/socket APIs) stay out of the
 * browser bundle.
 */

export type { Attachment } from './attachment.js';
export {
  AttachmentSchema,
  ATTACHMENT_FORMAT,
  ATTACHMENT_JSON_SCHEMA,
  ATTACHMENT_ARRAY_JSON_SCHEMA,
  markAttachmentFields,
  isAttachment,
  mimeAccepted,
  attachmentProperty,
} from './attachment.js';
export type {
  CitationRef,
  Locator,
  RefCitation,
  UrlCitation,
  DerivedCitation,
  SourceCitation,
  CitationMap,
} from './citation-ref.js';
export {
  CitationRefSchema,
  LocatorSchema,
  RefCitationSchema,
  UrlCitationSchema,
  DerivedCitationSchema,
  CITATION_REF_JSON_SCHEMA,
  CITATION_DIRECTIVE_ATTRS,
  CITED_VALUE_SEGMENTS,
  splitCitedRef,
  isCitationRef,
  isCitationRefArray,
} from './citation-ref.js';
export type { PayloadError } from './validate-payload.js';
export { validateTriggerPayload } from './validate-payload.js';
export type {
  ResumePayload,
  ResumeAttachment,
  ResumeAction,
} from './resume-payload.js';
export {
  isExecutable,
  extensionOf,
  BLOCKED_EXECUTABLE_MIME_TYPES,
  BLOCKED_EXECUTABLE_EXTENSIONS,
} from './executable-check.js';
// Node-path addressing for step records — pure string utilities (no Node deps),
// used by the execution viewer / approvals UI to map node-path keys ↔ config ids.
export { recordKey, framePrefix, leafStepId } from '../engine/node-path.js';


export type {
  // ─ Status & auth type enums ──
  CredentialStatus,
  CredentialAuthType,

  // ─ Per-auth-type value shapes ──
  BearerValues,
  BasicValues,
  CustomHeaderValues,
  OAuth2ClientCredentialsValues,
  SecretValues,

  CredentialAuth,
  CredentialValuesOf,
  AuthSpecificValues,

  // ─ Public API contract types ──

  CredentialSummary,
  ResolvedCredential,
  CreateCredentialInput,
  CreateCredentialRequest,
  CredentialTypeRef,
  CredentialTypeDescriptor,
  ConnectorCredentialTypes,
  ReplaceCredentialValuesInput,
  CredentialListItem,
  CredentialListResponse,

  // ─ Registry types (for UI form rendering) ──
  CredentialFieldControl,
  CredentialRegistryInputField,
  CredentialRegistryEntryField,
  CredentialRegistryEntry,
} from './credentials.js';

// ── Runtime value exports (Zod schemas, registry, validation helper) ──

export {
  // ─ Status & auth type Zod schemas ──
  CredentialStatusSchema,

  // ─ Per-auth-type Zod value schemas ──
  BearerValuesSchema,
  BasicValuesSchema,
  CustomHeaderValuesSchema,
  OAuth2ClientCredentialsValuesSchema,
  SecretValuesSchema,
  CredentialAuthSchema,

  // ─ Value schema registry (runtime validation) ──

  CREDENTIAL_VALUE_SCHEMAS,

  // ─ Validation helper ──
  validateCredentialAuth,
  validateCredentialValues,
  applyResolvedCredentialAuth,
  credentialValues,

  // ─ Credential name schema ──
  CredentialNameSchema,

  // ─ The minimal auth-type registry ──
  CREDENTIAL_AUTH_REGISTRY,
} from './credentials.js';
