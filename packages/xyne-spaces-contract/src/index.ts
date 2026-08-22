/**
 * @xyne/spaces-contract — the shared contract for the Xyne Spaces public API.
 *
 * Consumed by:
 *  - apps/backend (`src/api/sdk`) to render error envelopes and validate search
 *  - packages/xyne-spaces-sdk, at build time, to check that the two agree
 *
 * This package never imports the Zero registries, Prisma, or anything from an
 * app — it is pure contract so both sides can depend on it without a cycle.
 */

export {
  ERROR_CATALOG,
  isErrorCode,
  type ErrorCode,
  type ErrorDetail,
  type ApiErrorBody,
} from './errors.js';

export {
  searchQuerySchema,
  searchSchemaQuerySchema,
} from './schemas/search.js';

export { REQUEST_ID_HEADER, API_VERSION } from './conventions.js';
