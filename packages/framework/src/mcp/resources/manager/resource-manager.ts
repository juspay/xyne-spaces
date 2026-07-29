/**
 * Resource manager that orchestrates discovery, access, and validation
 */

import type { MCPClient } from '../../core/base/mcp-client.js';
import type { 
  ResourceCatalog, 
  ResourceQuery, 
  ResourceDiscoveryOptions,
  CatalogEntry
} from '../types/index.js';
import { ResourceDiscovery } from '../discovery/resource-discovery.js';
import { ResourceAccessor, type ResourceAccessOptions, type ResourceAccessResult } from '../access/resource-accessor.js';
import { ResourceValidator, type ValidationOptions, type ResourceValidationResult } from '../validation/resource-validator.js';
import { MCPError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Resource manager options
 */
export interface ResourceManagerOptions {
  readonly discovery?: ResourceDiscoveryOptions;
  readonly access?: ResourceAccessOptions;
  readonly validation?: ValidationOptions;
  readonly autoValidate?: boolean;
}

/**
 * Resource manager statistics
 */
export interface ResourceManagerStats {
  readonly totalResources: number;
  readonly serverCount: number;
  readonly validatedResources: number;
  readonly failedValidations: number;
  lastDiscoveryTime?: Date;
  lastValidationTime?: Date;
}

/**
 * Comprehensive resource result combining access and validation
 */
export interface ManagedResourceResult {
  readonly accessResult: ResourceAccessResult;
  validationResult?: ResourceValidationResult;
  catalogEntry?: CatalogEntry;
}

/**
 * Orchestrates resource discovery, access, and validation for MCP servers
 */
export class ResourceManager {
  private readonly discovery: ResourceDiscovery;
  private readonly accessor: ResourceAccessor;
  private readonly validator: ResourceValidator;
  
  private currentCatalog: ResourceCatalog | undefined;
  private validationResults = new Map<string, ResourceValidationResult>();
  
  constructor(
    private readonly mcpClient: MCPClient,
    private readonly options: ResourceManagerOptions = {}
  ) {
    this.discovery = new ResourceDiscovery(mcpClient);
    this.accessor = new ResourceAccessor(mcpClient);
    this.validator = new ResourceValidator();
  }

  /**
   * Initialize the resource manager by discovering all resources
   */
  public async initialize(): Promise<void> {
    logger.info('Initializing resource manager');
    
    if (!this.mcpClient.isInitialized()) {
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: 'MCP client must be initialized before resource manager',
        severity: 'high',
        retryable: false,
        timestamp: new Date()
      });
    }
    
    try {
      await this.discoverResources();
      
      if (this.options.autoValidate && this.currentCatalog) {
        this.validateCatalog();
      }
      
      logger.info('Resource manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize resource manager', error as Error);
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: `Resource manager initialization failed: ${(error as Error).message}`,
        severity: 'high',
        retryable: true,
        timestamp: new Date(),
        originalError: error as Error
      });
    }
  }

  /**
   * Discover all resources from connected servers
   */
  public async discoverResources(): Promise<ResourceCatalog> {
    logger.info('Starting resource discovery');
    
    this.currentCatalog = await this.discovery.discoverAll(this.options.discovery);
    
    logger.info(`Discovered ${this.currentCatalog.totalCount} resources from ${Object.keys(this.currentCatalog.serverCounts).length} servers`);
    
    return this.currentCatalog;
  }

  /**
   * Get the current resource catalog
   */
  public getCatalog(): ResourceCatalog | undefined {
    return this.currentCatalog;
  }

  /**
   * Query resources with filtering
   */
  public queryResources(query: ResourceQuery): CatalogEntry[] {
    if (!this.currentCatalog) {
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: 'No resources discovered yet. Call discoverResources() first.',
        severity: 'medium',
        retryable: true,
        timestamp: new Date()
      });
    }

    return this.discovery.queryResources(this.currentCatalog, query);
  }

  /**
   * Access a resource with optional validation
   */
  public async accessResource(
    uri: string, 
    options: { validate?: boolean } = {}
  ): Promise<ManagedResourceResult> {
    logger.debug(`Accessing resource: ${uri}`);

    // Get catalog entry if available
    const catalogEntry = this.currentCatalog?.entries.find(entry => entry.resource.uri === uri);

    // Access the resource
    const accessResult = await this.accessor.accessResource(uri, this.options.access);

    // Validate if requested
    let validationResult: ResourceValidationResult | undefined;
    if (options.validate !== false && (options.validate || this.options.autoValidate)) {
      if (catalogEntry) {
        validationResult = this.validator.validateResource(
          catalogEntry, 
          accessResult.content, 
          this.options.validation
        );
        
        // Cache validation result
        this.validationResults.set(uri, validationResult);
      }
    }

    const result: ManagedResourceResult = { accessResult };
    if (validationResult !== undefined) {
      result.validationResult = validationResult;
    }
    if (catalogEntry !== undefined) {
      result.catalogEntry = catalogEntry;
    }
    return result;
  }

  /**
   * Batch access multiple resources
   */
  public async batchAccessResources(
    uris: readonly string[], 
    options: { validate?: boolean } = {}
  ): Promise<Map<string, ManagedResourceResult | Error>> {
    logger.info(`Batch accessing ${uris.length} resources`);

    const results = new Map<string, ManagedResourceResult | Error>();
    
    // Process in chunks to manage concurrency
    const chunkSize = 5;
    const chunks = this.chunkArray([...uris], chunkSize);
    
    for (const chunk of chunks) {
      const promises = chunk.map(async (uri) => {
        try {
          const result = await this.accessResource(uri, options);
          results.set(uri, result);
        } catch (error) {
          results.set(uri, error as Error);
        }
      });
      
      await Promise.all(promises);
    }
    
    return results;
  }

  /**
   * Validate all resources in the current catalog
   */
  public validateCatalog(): Map<string, ResourceValidationResult> {
    if (!this.currentCatalog) {
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: 'No catalog available for validation. Discover resources first.',
        severity: 'medium',
        retryable: true,
        timestamp: new Date()
      });
    }

    logger.info(`Validating ${this.currentCatalog.totalCount} resources`);

    const validationResults = this.validator.validateBatch(
      this.currentCatalog.entries, 
      this.options.validation
    );

    // Update cached validation results
    this.validationResults.clear();
    validationResults.forEach((result, uri) => {
      this.validationResults.set(uri, result);
    });

    const validCount = Array.from(validationResults.values()).filter(r => r.valid).length;
    const invalidCount = validationResults.size - validCount;

    logger.info(`Validation complete: ${validCount} valid, ${invalidCount} invalid resources`);

    return validationResults;
  }

  /**
   * Get validation result for a specific resource
   */
  public getValidationResult(uri: string): ResourceValidationResult | undefined {
    return this.validationResults.get(uri);
  }

  /**
   * Check if a resource exists
   */
  public async resourceExists(uri: string, serverName?: string): Promise<boolean> {
    return this.accessor.exists(uri, serverName);
  }

  /**
   * Resolve URI to find which servers can provide it
   */
  public async resolveUri(uri: string): Promise<import('../access/resource-accessor.js').UriResolutionResult[]> {
    return this.accessor.resolveUri(uri, this.currentCatalog);
  }

  /**
   * Get statistics about managed resources
   */
  public getStats(): ResourceManagerStats {
    const stats: ResourceManagerStats = {
      totalResources: this.currentCatalog?.totalCount || 0,
      serverCount: Object.keys(this.currentCatalog?.serverCounts || {}).length,
      validatedResources: Array.from(this.validationResults.values()).filter(r => r.valid).length,
      failedValidations: Array.from(this.validationResults.values()).filter(r => !r.valid).length
    };

    if (this.currentCatalog?.lastUpdated) {
      stats.lastDiscoveryTime = this.currentCatalog.lastUpdated;
    }

    if (this.validationResults.size > 0) {
      stats.lastValidationTime = new Date(Math.max(...Array.from(this.validationResults.values()).map(r => r.validatedAt.getTime())));
    }

    return stats;
  }

  /**
   * Refresh the resource catalog
   */
  public async refresh(): Promise<void> {
    logger.info('Refreshing resource catalog');
    
    await this.discoverResources();
    
    if (this.options.autoValidate) {
      this.validateCatalog();
    }
    
    logger.info('Resource catalog refreshed');
  }

  /**
   * Clear all cached data
   */
  public clear(): void {
    this.currentCatalog = undefined;
    this.validationResults.clear();
    logger.info('Resource manager cache cleared');
  }

  /**
   * Get resources by server
   */
  public getResourcesByServer(serverName: string): CatalogEntry[] {
    return this.queryResources({ serverName });
  }

  /**
   * Get resources by MIME type
   */
  public getResourcesByMimeType(mimeType: string): CatalogEntry[] {
    return this.queryResources({ mimeType });
  }

  /**
   * Search resources by name pattern
   */
  public searchResources(namePattern: string): CatalogEntry[] {
    return this.queryResources({ namePattern });
  }

  /**
   * Get failed validations
   */
  public getFailedValidations(): ResourceValidationResult[] {
    return Array.from(this.validationResults.values()).filter(r => !r.valid);
  }

  /**
   * Get validation warnings
   */
  public getValidationWarnings(): ResourceValidationResult[] {
    return Array.from(this.validationResults.values()).filter(r => r.warnings.length > 0);
  }

  /**
   * Utility to chunk array for batch processing
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}