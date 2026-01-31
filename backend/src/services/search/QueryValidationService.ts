import { SEARCH_CONFIG } from './search.constants';
import { GlobalSearchFilters, SearchableEntityType } from './types';

/**
 * QueryValidationService
 *
 * Responsibility: Validate search query parameters and filters
 *
 * This service handles:
 * - Query length validation (min/max)
 * - Pagination parameter validation (page, limit)
 * - Entity type validation
 * - Search type validation
 */
export class QueryValidationService {
  // Valid entity types for search
  private readonly VALID_ENTITY_TYPES: SearchableEntityType[] = [
    'users',
    'messages',
    'channels',
    'tickets',
    'attachments',
  ];

  // Valid search types
  private readonly VALID_SEARCH_TYPES = ['trigram', 'fts', 'both'] as const;

  /**
   * Validate search filters
   *
   * Throws an error if any validation fails.
   * This ensures all downstream code can safely assume valid inputs.
   *
   * Validations performed:
   * 1. Query is present and non-empty
   * 2. Query length is within configured bounds
   * 3. Page number is positive (if provided)
   * 4. Limit is within configured bounds (if provided)
   * 5. Entity types are valid (if provided)
   * 6. Search type is valid (if provided)
   *
   * @param filters - Search filters to validate
   * @throws Error if any validation fails
   */
  validate(filters: GlobalSearchFilters): void {
    this.validateQuery(filters.query);
    this.validatePagination(filters.page, filters.limit);
    this.validateEntityTypes(filters.entityTypes);
    this.validateSearchType(filters.searchType);
  }

  /**
   * Validate search query
   *
   * Checks:
   * - Query is present and not empty/whitespace
   * - Query length is at least minQueryLength
   * - Query length is at most maxQueryLength
   *
   * @private
   */
  private validateQuery(query: string): void {
    // Check if query exists and is not empty after trimming
    if (!query || query.trim().length === 0) {
      throw new Error('Search query is required');
    }

    // Check minimum length
    if (query.length < SEARCH_CONFIG.limits.minQueryLength) {
      throw new Error(
        `Search query must be at least ${SEARCH_CONFIG.limits.minQueryLength} characters long`
      );
    }

    // Check maximum length
    if (query.length > SEARCH_CONFIG.limits.maxQueryLength) {
      throw new Error(
        `Search query must be less than ${SEARCH_CONFIG.limits.maxQueryLength} characters`
      );
    }
  }

  /**
   * Validate pagination parameters
   *
   * Checks:
   * - Page is positive (>= 1)
   * - Limit is within configured bounds (1 to maxPageSize)
   *
   * @private
   */
  private validatePagination(page?: number, limit?: number): void {
    // Validate page number if provided
    if (page !== undefined && page < 1) {
      throw new Error('Page must be greater than 0');
    }

    // Validate limit if provided
    if (limit !== undefined) {
      if (limit < 1 || limit > SEARCH_CONFIG.limits.maxPageSize) {
        throw new Error(
          `Limit must be between 1 and ${SEARCH_CONFIG.limits.maxPageSize}`
        );
      }
    }
  }

  /**
   * Validate entity types
   *
   * Checks that all provided entity types are valid
   *
   * @private
   */
  private validateEntityTypes(entityTypes?: SearchableEntityType[]): void {
    if (!entityTypes) {
      return; // Optional parameter, no validation needed
    }

    for (const type of entityTypes) {
      if (!this.VALID_ENTITY_TYPES.includes(type)) {
        throw new Error(`Invalid entity type: ${type}`);
      }
    }
  }

  /**
   * Validate search type
   *
   * Checks that search type is one of: 'trigram', 'fts', 'both'
   *
   * @private
   */
  private validateSearchType(searchType?: string): void {
    if (!searchType) {
      return; // Optional parameter, no validation needed
    }

    if (!this.VALID_SEARCH_TYPES.includes(searchType as any)) {
      throw new Error(`Invalid search type: ${searchType}`);
    }
  }
}
