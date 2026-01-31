/**
 * Configuration manager for Xyne automation framework
 * TypeScript equivalent of Python's ConfigManager
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { TestConfig } from '../../types/index';

export class ConfigManager {
  private config: TestConfig;
  private environment: string;

  constructor(environment: string = 'local') {
    this.environment = environment;
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from file or environment variables
   */
  private loadConfig(): TestConfig {
    // Default configuration
    const defaultConfig: TestConfig = {
      baseUrl: process.env.XYNE_SPACES_URL || 'https://spaces.xyne.juspay.net',
      apiBaseUrl: process.env.XYNE_SPACES_API_URL || 'https://spaces.xyne.juspay.net/api',
      browser: (process.env.BROWSER as 'chromium' | 'firefox' | 'webkit') || 'chromium',
      headless: process.env.HEADLESS === 'true',
      viewport: {
        width: parseInt(process.env.VIEWPORT_WIDTH || '1920'),
        height: parseInt(process.env.VIEWPORT_HEIGHT || '1080')
      },
      timeout: {
        action: parseInt(process.env.ACTION_TIMEOUT || '30000'),
        navigation: parseInt(process.env.NAVIGATION_TIMEOUT || '30000'),
        test: parseInt(process.env.TEST_TIMEOUT || '60000')
      },
      llm: {
        openaiApiKey: process.env.OPENAI_API_KEY,
        model: process.env.LLM_MODEL || 'gpt-4',
        similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7')
      },
      performance: {
        maxResponseTime: parseFloat(process.env.MAX_RESPONSE_TIME || '10.0'),
        maxErrorRate: parseFloat(process.env.MAX_ERROR_RATE || '5.0')
      },
      reporting: {
        screenshotOnFailure: process.env.SCREENSHOT_ON_FAILURE !== 'false',
        videoRecording: process.env.VIDEO_RECORDING === 'true',
        harRecording: process.env.HAR_RECORDING === 'true'
      }
    };

    // Try to load from config file
    const configFile = this.getConfigFilePath();
    if (fs.existsSync(configFile)) {
      try {
        const fileContent = fs.readFileSync(configFile, 'utf8');
        const fileConfig = yaml.parse(fileContent);
        return this.mergeConfigs(defaultConfig, fileConfig);
      } catch (error) {
        console.warn(`Failed to load config file ${configFile}:`, error);
      }
    }

    return defaultConfig;
  }

  /**
   * Get configuration file path based on environment
   */
  private getConfigFilePath(): string {
    const configDir = path.join(process.cwd(), 'config');
    return path.join(configDir, `${this.environment}.yaml`);
  }

  /**
   * Merge default config with file config
   */
  private mergeConfigs(defaultConfig: TestConfig, fileConfig: any): TestConfig {
    return {
      ...defaultConfig,
      ...fileConfig,
      viewport: { ...defaultConfig.viewport, ...fileConfig.viewport },
      timeout: { ...defaultConfig.timeout, ...fileConfig.timeout },
      llm: { ...defaultConfig.llm, ...fileConfig.llm },
      performance: { ...defaultConfig.performance, ...fileConfig.performance },
      reporting: { ...defaultConfig.reporting, ...fileConfig.reporting }
    };
  }

  /**
   * Get the complete configuration
   */
  public getConfig(): TestConfig {
    return this.config;
  }

  /**
   * Get base URL
   */
  public getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Get API base URL
   */
  public getApiBaseUrl(): string {
    return this.config.apiBaseUrl;
  }

  /**
   * Get login page URL
   */
  public getLoginUrl(): string {
    return `${this.config.baseUrl}/auth`;
  }

  /**
   * Get chat page URL
   */
  public getChatUrl(): string {
    return `${this.config.baseUrl}/chat`;
  }

  /**
   * Get browser configuration
   */
  public getBrowserConfig() {
    return {
      browser: this.config.browser,
      headless: this.config.headless,
      viewport: this.config.viewport
    };
  }

  /**
   * Get timeout configuration
   */
  public getTimeouts() {
    return this.config.timeout;
  }

  /**
   * Get LLM configuration
   */
  public getLLMConfig() {
    return this.config.llm;
  }

  /**
   * Get performance thresholds
   */
  public getPerformanceConfig() {
    return this.config.performance;
  }

  /**
   * Get reporting configuration
   */
  public getReportingConfig() {
    return this.config.reporting;
  }

  /**
   * Validate configuration
   */
  public validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate URLs
    try {
      new URL(this.config.baseUrl);
    } catch {
      errors.push('Invalid base URL');
    }

    try {
      new URL(this.config.apiBaseUrl);
    } catch {
      errors.push('Invalid API base URL');
    }

    // Validate browser
    const browserType = typeof this.config.browser === 'string' 
      ? this.config.browser 
      : this.config.browser.type;
    if (!['chromium', 'firefox', 'webkit'].includes(browserType)) {
      errors.push('Invalid browser type');
    }

    // Validate viewport
    if (this.config.viewport.width <= 0 || this.config.viewport.height <= 0) {
      errors.push('Invalid viewport dimensions');
    }

    // Validate timeouts
    if (this.config.timeout.action <= 0 || this.config.timeout.navigation <= 0 || this.config.timeout.test <= 0) {
      errors.push('Invalid timeout values');
    }

    // Validate LLM config
    if (this.config.llm.similarityThreshold < 0 || this.config.llm.similarityThreshold > 1) {
      errors.push('Similarity threshold must be between 0 and 1');
    }

    // Validate performance config
    if (this.config.performance.maxResponseTime <= 0 || this.config.performance.maxErrorRate < 0) {
      errors.push('Invalid performance thresholds');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Create default config file
   */
  public createDefaultConfigFile(): void {
    const configDir = path.join(process.cwd(), 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const defaultConfigContent = `# Xyne Automation Framework Configuration
# Environment: ${this.environment}

# Application URLs
baseUrl: "${this.config.baseUrl}"
apiBaseUrl: "${this.config.apiBaseUrl}"

# Browser settings
browser: "${this.config.browser}"
headless: ${this.config.headless}

# Viewport settings
viewport:
  width: ${this.config.viewport.width}
  height: ${this.config.viewport.height}

# Timeout settings (in milliseconds)
timeout:
  action: ${this.config.timeout.action}
  navigation: ${this.config.timeout.navigation}
  test: ${this.config.timeout.test}

# LLM Evaluation settings
llm:
  openaiApiKey: "\${OPENAI_API_KEY}"
  model: "${this.config.llm.model}"
  similarityThreshold: ${this.config.llm.similarityThreshold}

# Performance thresholds
performance:
  maxResponseTime: ${this.config.performance.maxResponseTime}
  maxErrorRate: ${this.config.performance.maxErrorRate}

# Reporting settings
reporting:
  screenshotOnFailure: ${this.config.reporting.screenshotOnFailure}
  videoRecording: ${this.config.reporting.videoRecording}
  harRecording: ${this.config.reporting.harRecording}
`;

    const configFile = this.getConfigFilePath();
    fs.writeFileSync(configFile, defaultConfigContent);
    console.log(`Created default config file: ${configFile}`);
  }

  /**
   * Update configuration at runtime
   */
  public updateConfig(updates: Partial<TestConfig>): void {
    this.config = this.mergeConfigs(this.config, updates);
  }

  /**
   * Get environment name
   */
  public getEnvironment(): string {
    return this.environment;
  }
}

// Export singleton instance
export const configManager = new ConfigManager(process.env.NODE_ENV || 'local');