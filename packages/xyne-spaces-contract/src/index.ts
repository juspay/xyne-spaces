/**
 * @xyne/spaces-contract — the shared contract for the Xyne Spaces public API.
 *
 * Consumed by:
 *  - apps/backend (`src/api/v1`) to enforce scopes and render error envelopes
 *  - tools/xyne-spaces-openapi-gen to emit the committed OpenAPI document
 *  - packages/xyne-spaces-sdk for typed error classes and scope constants
 *
 * This package never imports the Zero registries, Prisma, or anything from an
 * app — it is pure contract so both sides can depend on it without a cycle.
 */

export {
  ERROR_CODES,
  ERROR_CATALOG,
  isErrorCode,
  statusForCode,
  isRetryable,
  type ErrorCode,
  type ErrorDefinition,
  type ErrorDetail,
  type ApiErrorBody,
} from './errors.js';

export {
  RESOURCE_FAMILIES,
  ALL_SCOPES,
  SCOPE_CATALOG,
  ADMIN_SCOPE,
  LEGACY_SCOPE_EQUIVALENTS,
  readScope,
  writeScope,
  isScope,
  type ResourceFamily,
  type Scope,
  type ReadScope,
  type WriteScope,
  type AdminScope,
  type ScopeDefinition,
} from './scopes.js';

export {
  searchQuerySchema,
  searchSchemaQuerySchema,
  searchResponseSchema,
  VESPA_SCHEMAS,
  type SearchQuery,
} from './schemas/search.js';

export {
  userSchema,
  userProfileSchema,
  meSchema,
  type User,
  type UserProfile,
  type Me,
} from './schemas/users.js';

export {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  BATCH_IDS_MAX,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  REQUEST_ID_HEADER,
  API_VERSION,
  type PageInfo,
  type ListResponse,
} from './conventions.js';
