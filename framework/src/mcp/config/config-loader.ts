import { promises as fs, readFileSync } from 'fs';
import path from 'path';
import type { MCPConfig, MCPConfigOptions } from '../core/types/config.js';
import { validateMCPConfig, getDefaultMCPConfig } from './config-validator.js';
import { EnvironmentResolver } from './environment-resolver.js';
import { createMCPConfigError } from '../core/errors/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Configuration loading result
 */
export interface MCPConfigLoadResult {
  readonly success: boolean;
  readonly config?: MCPConfig;
  readonly configPath?: string;
  readonly errors?: readonly string[];
  readonly warnings?: readonly string[];
}

/**
 * MCP configuration loader
 */
export class MCPConfigLoader {
  private readonly options: MCPConfigOptions;
  private readonly environmentResolver: EnvironmentResolver;

  constructor(options: MCPConfigOptions = {}) {
    // Validate that at least one path is provided
    if (!options.localPath && !options.globalPath) {
      throw createMCPConfigError(
        'At least one configuration path must be provided (localPath or globalPath)',
        {
          severity: 'critical'
        }
      );
    }

    this.options = options;
    
    this.environmentResolver = new EnvironmentResolver({
      throwOnMissing: true,
      allowEmpty: false
    });
  }

  /**
   * Load MCP configuration from file system
   */
  public async loadConfig(): Promise<MCPConfigLoadResult> {
    logger.info('Loading MCP configuration', {
      globalPath: this.options.globalPath,
      localPath: this.options.localPath
    });
    
    try {
      const warnings: string[] = [];
      let mergedConfig: unknown = {};
      const configPaths: string[] = [];
      
      const loadErrors: string[] = [];
      
      // Load global config first (if provided)
      if (this.options.globalPath) {
        try {
          const globalPath = path.resolve(this.options.globalPath);
          const globalConfig = await this.readConfigFile(globalPath);
          mergedConfig = this.processConfig(globalConfig, warnings);
          configPaths.push(globalPath);
          logger.debug('Global configuration loaded', { globalPath });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          loadErrors.push(`Failed to load global configuration: ${errorMessage}`);
          logger.debug('Global configuration not available', { globalPath: this.options.globalPath, error: errorMessage });
        }
      }
      
      // Load local config second (if provided)
      if (this.options.localPath) {
        try {
          const localPath = path.resolve(this.options.localPath);
          const localConfig = await this.readConfigFile(localPath);
          const processedLocalConfig = this.processConfig(localConfig, warnings);
          
          // Merge local config with global config (local takes precedence)
          mergedConfig = this.mergeConfigs(mergedConfig, processedLocalConfig);
          configPaths.push(localPath);
          logger.debug('Local configuration loaded and merged', { localPath });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          loadErrors.push(`Failed to load local configuration: ${errorMessage}`);
          logger.debug('Local configuration not available', { localPath: this.options.localPath, error: errorMessage });
        }
      }
      
      // Only fail if ALL specified paths failed to load
      if (loadErrors.length > 0 && configPaths.length === 0) {
        return {
          success: false,
          errors: loadErrors
        };
      }
      
      // Merge with defaults
      const configWithDefaults = this.mergeWithDefaults(mergedConfig);
      
      // Always validate configuration
      const validationResult = validateMCPConfig(configWithDefaults);
      
      if (!validationResult.success) {
        return {
          success: false,
          configPath: configPaths.join(', '),
          errors: validationResult.errors || ['Configuration validation failed']
        };
      }
      
      const finalConfig = validationResult.data!;
      
      logger.info('MCP configuration loaded successfully', {
        configPaths,
        serverCount: Object.keys(finalConfig.mcpServers).length,
        hasWarnings: warnings.length > 0
      });
      
      const result: MCPConfigLoadResult = {
        success: true,
        config: finalConfig,
        configPath: configPaths.join(', '),
        ...(warnings.length > 0 && { warnings })
      };
      
      return result;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to load MCP configuration', error as Error);
      
      return {
        success: false,
        errors: [`Configuration loading failed: ${errorMessage}`]
      };
    }
  }

  /**
   * Load configuration synchronously (for testing)
   */
  public loadConfigSync(): MCPConfig {
    try {
      let mergedConfig: unknown = {};
      const configPaths: string[] = [];
      
      // Load global config first (if provided)
      if (this.options.globalPath) {
        const globalPath = path.resolve(this.options.globalPath);
        const configData = readFileSync(globalPath, 'utf-8');
        const globalConfig: unknown = JSON.parse(configData);
        mergedConfig = this.environmentResolver.resolveOrThrow(globalConfig);
        configPaths.push(globalPath);
      }
      
      // Load local config second (if provided)
      if (this.options.localPath) {
        const localPath = path.resolve(this.options.localPath);
        const configData = readFileSync(localPath, 'utf-8');
        const localConfig: unknown = JSON.parse(configData);
        const processedLocalConfig = this.environmentResolver.resolveOrThrow(localConfig);
        
        // Merge local config with global config (local takes precedence)
        mergedConfig = this.mergeConfigs(mergedConfig, processedLocalConfig);
        configPaths.push(localPath);
      }
      
      // Merge with defaults
      const configWithDefaults = this.mergeWithDefaults(mergedConfig);
      
      // Always validate configuration
      const validationResult = validateMCPConfig(configWithDefaults);
      
      if (!validationResult.success) {
        throw createMCPConfigError(
          'Configuration validation failed',
          {
            validationErrors: validationResult.errors || [],
            configPath: configPaths.join(', ')
          }
        );
      }
      
      return validationResult.data!;
      
    } catch (error) {
      if (error instanceof Error && 'mcpError' in error) {
        throw error; // Re-throw MCP errors
      }
      
      const configPaths = [this.options.globalPath, this.options.localPath].filter(Boolean);
      
      throw createMCPConfigError(
        `Failed to load configuration from ${configPaths.join(', ')}`,
        {
          configPath: configPaths.join(', '),
          originalError: error as Error
        }
      );
    }
  }

  /**
   * Check if configuration files exist
   */
  public async configExists(): Promise<boolean> {
    try {
      let globalExists = true;
      let localExists = true;
      
      if (this.options.globalPath) {
        try {
          await fs.access(path.resolve(this.options.globalPath));
        } catch {
          globalExists = false;
        }
      }
      
      if (this.options.localPath) {
        try {
          await fs.access(path.resolve(this.options.localPath));
        } catch {
          localExists = false;
        }
      }
      
      // Return true if at least one required config file exists
      return (this.options.globalPath ? globalExists : true) && 
             (this.options.localPath ? localExists : true);
    } catch {
      return false;
    }
  }

  /**
   * Get the resolved configuration file paths
   */
  public getConfigPaths(): string[] {
    const paths: string[] = [];
    
    if (this.options.globalPath) {
      paths.push(path.resolve(this.options.globalPath));
    }
    
    if (this.options.localPath) {
      paths.push(path.resolve(this.options.localPath));
    }
    
    return paths;
  }

  /**
   * Read and parse configuration file
   */
  private async readConfigFile(configPath: string): Promise<unknown> {
    try {
      const configData = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      if (error instanceof Error) {
        if ('code' in error && error.code === 'ENOENT') {
          throw createMCPConfigError(
            `Configuration file not found: ${configPath}`,
            {
              configPath,
              severity: 'critical'
            }
          );
        }
        
        if (error instanceof SyntaxError) {
          throw createMCPConfigError(
            `Invalid JSON in configuration file: ${error.message}`,
            {
              configPath,
              originalError: error
            }
          );
        }
      }
      
      throw createMCPConfigError(
        `Failed to read configuration file: ${configPath}`,
        {
          configPath,
          originalError: error as Error
        }
      );
    }
  }

  /**
   * Process a single configuration (env resolution)
   */
  private processConfig(config: unknown, warnings: string[]): unknown {
    // Always resolve environment variables
    const envResult = this.environmentResolver.resolveEnvironmentVariables(config);
    
    if (!envResult.success) {
      throw createMCPConfigError(
        'Environment variable resolution failed',
        {
          validationErrors: envResult.errors || []
        }
      );
    }
    
    if (envResult.missingVariables && envResult.missingVariables.length > 0) {
      warnings.push(`Some environment variables were not resolved: ${envResult.missingVariables.join(', ')}`);
    }
    
    return envResult.resolvedConfig!;
  }

  /**
   * Merge two configurations with local precedence
   */
  private mergeConfigs(globalConfig: unknown, localConfig: unknown): unknown {
    if (!this.isObject(globalConfig)) globalConfig = {};
    if (!this.isObject(localConfig)) localConfig = {};
    
    const global = globalConfig as Record<string, unknown>;
    const local = localConfig as Record<string, unknown>;
    
    const merged = { ...global, ...local };
    
    // Special handling for mcpServers - local servers completely override global servers with same name
    if (this.isObject(global['mcpServers']) && this.isObject(local['mcpServers'])) {
      merged['mcpServers'] = {
        ...global['mcpServers'],
        ...local['mcpServers']
      };
    }
    
    // Deep merge for security, performance, features (local takes precedence)
    const deepMergeKeys = ['security', 'performance', 'features'];
    for (const key of deepMergeKeys) {
      if (this.isObject(global[key]) || this.isObject(local[key])) {
        merged[key] = {
          ...(this.isObject(global[key]) ? global[key] : {}),
          ...(this.isObject(local[key]) ? local[key] : {})
        };
      }
    }
    
    return merged;
  }

  /**
   * Merge loaded configuration with defaults
   */
  private mergeWithDefaults(config: unknown): unknown {
    const defaults = getDefaultMCPConfig();
    
    if (typeof config !== 'object' || config === null) {
      throw createMCPConfigError(
        'Configuration must be an object',
        {
          validationErrors: ['Configuration root must be an object']
        }
      );
    }
    
    const configObj = config as Record<string, unknown>;
    
    return {
      ...defaults,
      ...config,
      // Deep merge nested objects
      security: {
        ...defaults.security,
        ...(this.isObject(configObj['security']) ? configObj['security'] : {})
      },
      performance: {
        ...defaults.performance,
        ...(this.isObject(configObj['performance']) ? configObj['performance'] : {})
      },
      features: {
        ...defaults.features,
        ...(this.isObject(configObj['features']) ? configObj['features'] : {})
      }
    };
  }

  /**
   * Type guard to check if value is an object
   */
  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Create a configuration loader with custom options
   */
  public static create(options: MCPConfigOptions): MCPConfigLoader {
    return new MCPConfigLoader(options);
  }

  /**
   * Create a configuration loader for testing
   */
  public static createForTesting(options: MCPConfigOptions): MCPConfigLoader {
    return new MCPConfigLoader(options);
  }

  /**
   * Quick load configuration with options
   */
  public static async load(options: MCPConfigOptions): Promise<MCPConfig> {
    const loader = new MCPConfigLoader(options);
    const result = await loader.loadConfig();
    
    if (!result.success) {
      const errorOptions = {
        validationErrors: result.errors || [],
        ...(result.configPath !== undefined && { configPath: result.configPath })
      };
      
      throw createMCPConfigError(
        'Failed to load MCP configuration',
        errorOptions
      );
    }
    
    return result.config!;
  }
}