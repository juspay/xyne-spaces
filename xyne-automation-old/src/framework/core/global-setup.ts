/**
 * Global setup for Playwright tests
 * Runs once before all tests
 */

import { FullConfig } from '@playwright/test';
import { configManager } from './config-manager';
import * as fs from 'fs';
import * as path from 'path';

async function globalSetup(config: FullConfig) {
  console.log(' Starting Xyne Automation Framework Global Setup');
  
  // Validate configuration
  const validation = configManager.validateConfig();
  if (!validation.valid) {
    console.error(' Configuration validation failed:');
    validation.errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
  
  console.log(' Configuration validated successfully');
  
  // Create necessary directories
  const directories = [
    'reports',
    'reports/screenshots',
    'reports/videos',
    'reports/traces',
    'reports/network',
    'reports/html-report',
    'reports/test-artifacts',
    'reports/api-calls'
  ];
  
  directories.forEach(dir => {
    const fullPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(` Created directory: ${dir}`);
    }
  });
  
  // Create default config file if it doesn't exist
  const configFile = path.join(process.cwd(), 'config', `${configManager.getEnvironment()}.yaml`);
  if (!fs.existsSync(configFile)) {
    configManager.createDefaultConfigFile();
    console.log(' Created default configuration file');
  }
  
  // Log configuration summary
  const testConfig = configManager.getConfig();
  console.log(' Test Configuration Summary:');
  console.log(`  Environment: ${configManager.getEnvironment()}`);
  console.log(`  Base URL: ${testConfig.baseUrl}`);
  console.log(`  API URL: ${testConfig.apiBaseUrl}`);
  console.log(`  Browser: ${testConfig.browser}`);
  console.log(`  Headless: ${testConfig.headless}`);
  console.log(`  Viewport: ${testConfig.viewport.width}x${testConfig.viewport.height}`);
  
  // Check OpenAI API key for LLM evaluation
  if (testConfig.llm.openaiApiKey) {
    console.log('🤖 OpenAI API key configured - LLM evaluation enabled');
  } else {
    console.log('️  OpenAI API key not configured - LLM evaluation will be skipped');
  }
  
  console.log(' Global setup completed successfully\n');
}

export default globalSetup;
