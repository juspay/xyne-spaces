#!/usr/bin/env node

/**
 * Comprehensive setup script for Xyne TypeScript Automation Framework
 * Single command setup for new developers
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n${colors.cyan}[${step}]${colors.reset} ${colors.bright}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`${colors.green}✅ ${message}${colors.reset}`);
}

function logError(message) {
  log(`${colors.red}❌ ${message}${colors.reset}`);
}

function logWarning(message) {
  log(`${colors.yellow}⚠️  ${message}${colors.reset}`);
}

// Create readline interface for user input
let rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(`${colors.blue}${question}${colors.reset}`, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Ask question with timeout functionality
 * @param {string} question - The question to ask
 * @param {string} defaultValue - Default value to use on timeout
 * @param {number} timeoutMs - Timeout in milliseconds (default: 40000)
 * @param {boolean} showCountdown - Whether to show countdown for longer timeouts
 * @returns {Promise<string>} - User input or default value
 */
function askQuestionWithTimeout(question, defaultValue, timeoutMs = 40000, showCountdown = false) {
  return new Promise((resolve) => {
    let timeoutId;
    let countdownInterval;
    let answered = false;
    
    // Show countdown for longer timeouts (>60 seconds)
    if (showCountdown && timeoutMs > 60000) {
      let remainingSeconds = Math.floor(timeoutMs / 1000);
      log(`${colors.yellow}⏰ Auto-proceeding in ${remainingSeconds} seconds if no input provided${colors.reset}`);
      log(`${colors.yellow}💡 You can paste your API key at any time during the countdown${colors.reset}`);
      
      countdownInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds > 0 && remainingSeconds % 10 === 0) {
          // Use a new line instead of overwriting the current line to avoid interfering with user input
          log(`${colors.yellow}⏰ ${remainingSeconds} seconds remaining...${colors.reset}`);
        }
      }, 1000);
    }
    
    // Set up timeout
    timeoutId = setTimeout(() => {
      if (!answered) {
        answered = true;
        if (countdownInterval) clearInterval(countdownInterval);
        
        // Clear the current line and show timeout message
        process.stdout.write('\r\x1b[K'); // Clear line
        log(`${colors.yellow}⏰ Timeout reached, using default: ${colors.bright}${defaultValue}${colors.reset}`);
        resolve(defaultValue);
      }
    }, timeoutMs);
    
    // Use the global readline interface instead of creating a new one
    rl.question(`${colors.blue}${question}${colors.reset}`, (answer) => {
      if (!answered) {
        answered = true;
        clearTimeout(timeoutId);
        if (countdownInterval) clearInterval(countdownInterval);
        
        // Clear countdown line if it was shown
        if (showCountdown && timeoutMs > 60000) {
          process.stdout.write('\r\x1b[K'); // Clear line
        }
        
        const finalAnswer = answer.trim();
        resolve(finalAnswer || defaultValue);
      }
    });
  });
}

async function checkNodeVersion() {
  logStep('1', 'Checking Node.js version...');
  
  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
    
    logSuccess(`Node.js ${nodeVersion} found`);
    logSuccess(`npm ${npmVersion} found`);
    
    // Check if version is adequate (v16+)
    const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);
    if (majorVersion < 16) {
      logWarning(`Node.js ${nodeVersion} detected. Recommended: v16 or higher`);
      
      if (os.platform() === 'darwin') {
        log('\nTo upgrade Node.js on macOS:');
        log('  brew install node');
      } else {
        log('\nPlease visit https://nodejs.org to download the latest version');
      }
      
      const proceed = await askQuestionWithTimeout('Continue with current version? (y/n): ', 'y', 40000);
      if (proceed.toLowerCase() !== 'y') {
        process.exit(1);
      }
    }
    
    return true;
  } catch (error) {
    logError('Node.js not found');
    
    if (os.platform() === 'darwin') {
      log('\nTo install Node.js on macOS:');
      log('  brew install node');
    } else {
      log('\nPlease visit https://nodejs.org to download and install Node.js');
    }
    
    process.exit(1);
  }
}

async function installDependencies() {
  logStep('2', 'Installing npm dependencies...');
  
  try {
    execSync('npm install', { stdio: 'inherit' });
    logSuccess('Dependencies installed successfully');
  } catch (error) {
    logError('Failed to install dependencies');
    process.exit(1);
  }
}

async function installPlaywrightBrowsers() {
  logStep('3', 'Installing Playwright browsers...');
  
  try {
    execSync('npx playwright install', { stdio: 'inherit' });
    logSuccess('Playwright browsers installed successfully');
  } catch (error) {
    logError('Failed to install Playwright browsers');
    process.exit(1);
  }
}

async function setupEnvironmentFile() {
  logStep('4', 'Setting up environment configuration...');
  
  // Check if .env already exists
  if (fs.existsSync('.env')) {
    const overwrite = await askQuestionWithTimeout('.env file already exists. Overwrite? (y/n): ', 'n', 40000);
    if (overwrite.toLowerCase() !== 'y') {
      logSuccess('Keeping existing .env file');
      return;
    }
  }
  
  log('\n' + colors.bright + 'Environment Configuration Setup' + colors.reset);
  log('Please provide values for the following configuration variables:');
  log('(Press Enter to use default values shown in brackets)');
  log(`${colors.yellow}⏰ Note: Most inputs auto-proceed after 40 seconds, OpenAI API key after 120 seconds${colors.reset}\n`);
  
  // Required configuration variables
  const config = {};
  
  // Application URLs (40 second timeout)
  log(colors.yellow + ' Application URLs:' + colors.reset);
  config.XYNE_BASE_URL = await askQuestionWithTimeout('Base URL [https://xyne.juspay.net]: ', 'https://xyne.juspay.net', 40000);
  config.XYNE_API_URL = await askQuestionWithTimeout('API URL [https://xyne.juspay.net/api]: ', 'https://xyne.juspay.net/api', 40000);
  
  // Browser Configuration (40 second timeout)
  log('\n' + colors.yellow + '🌐 Browser Configuration:' + colors.reset);
  const browserChoice = await askQuestionWithTimeout('Default browser (chromium/firefox/webkit) [chromium]: ', 'chromium', 40000);
  config.BROWSER = ['chromium', 'firefox', 'webkit'].includes(browserChoice) ? browserChoice : 'chromium';
  
  const headlessChoice = await askQuestionWithTimeout('Run headless by default? (true/false) [false]: ', 'false', 40000);
  config.HEADLESS = headlessChoice.toLowerCase() === 'true' ? 'true' : 'false';
  
  config.VIEWPORT_WIDTH = await askQuestionWithTimeout('Viewport width [1920]: ', '1920', 40000);
  config.VIEWPORT_HEIGHT = await askQuestionWithTimeout('Viewport height [1080]: ', '1080', 40000);
  
  // Timeout Configuration (40 second timeout)
  log('\n' + colors.yellow + '⏱️  Timeout Configuration (milliseconds):' + colors.reset);
  config.ACTION_TIMEOUT = await askQuestionWithTimeout('Action timeout [30000]: ', '30000', 40000);
  config.NAVIGATION_TIMEOUT = await askQuestionWithTimeout('Navigation timeout [30000]: ', '30000', 40000);
  config.TEST_TIMEOUT = await askQuestionWithTimeout('Test timeout [60000]: ', '60000', 40000);
  
  // LLM Evaluation (120 second timeout for API key, 40 seconds for others)
  log('\n' + colors.yellow + '🤖 LLM Evaluation (Optional):' + colors.reset);
  const openaiKey = await askQuestionWithTimeout('OpenAI API Key (optional, for LLM evaluations): ', 'your-openai-api-key-here', 120000, true);
  config.OPENAI_API_KEY = openaiKey;
  config.LLM_MODEL = await askQuestionWithTimeout('LLM Model [gpt-4]: ', 'gpt-4', 40000);
  config.SIMILARITY_THRESHOLD = await askQuestionWithTimeout('Similarity threshold [0.7]: ', '0.7', 40000);
  
  // Performance Thresholds (40 second timeout)
  log('\n' + colors.yellow + '📊 Performance Thresholds:' + colors.reset);
  config.MAX_RESPONSE_TIME = await askQuestionWithTimeout('Max response time (seconds) [10.0]: ', '10.0', 40000);
  config.MAX_ERROR_RATE = await askQuestionWithTimeout('Max error rate (%) [5.0]: ', '5.0', 40000);
  
  // Reporting (40 second timeout)
  log('\n' + colors.yellow + '📋 Reporting Configuration:' + colors.reset);
  const screenshotChoice = await askQuestionWithTimeout('Screenshot on failure? (true/false) [true]: ', 'true', 40000);
  config.SCREENSHOT_ON_FAILURE = screenshotChoice.toLowerCase() === 'true' ? 'true' : 'false';
  
  const videoChoice = await askQuestionWithTimeout('Video recording? (true/false) [false]: ', 'false', 40000);
  config.VIDEO_RECORDING = videoChoice.toLowerCase() === 'true' ? 'true' : 'false';
  
  const harChoice = await askQuestionWithTimeout('HAR recording? (true/false) [true]: ', 'true', 40000);
  config.HAR_RECORDING = harChoice.toLowerCase() === 'true' ? 'true' : 'false';
  
  // Environment
  config.NODE_ENV = 'local';
  
  // Generate .env file content
  const envContent = `# Xyne Automation Framework Environment Variables
# Generated by setup script on ${new Date().toISOString()}

# Application URLs
XYNE_BASE_URL=${config.XYNE_BASE_URL}
XYNE_API_URL=${config.XYNE_API_URL}

# Browser Configuration
BROWSER=${config.BROWSER}
HEADLESS=${config.HEADLESS}
VIEWPORT_WIDTH=${config.VIEWPORT_WIDTH}
VIEWPORT_HEIGHT=${config.VIEWPORT_HEIGHT}

# Timeout Configuration (milliseconds)
ACTION_TIMEOUT=${config.ACTION_TIMEOUT}
NAVIGATION_TIMEOUT=${config.NAVIGATION_TIMEOUT}
TEST_TIMEOUT=${config.TEST_TIMEOUT}

# LLM Evaluation
OPENAI_API_KEY=${config.OPENAI_API_KEY}
LLM_MODEL=${config.LLM_MODEL}
SIMILARITY_THRESHOLD=${config.SIMILARITY_THRESHOLD}

# Performance Thresholds
MAX_RESPONSE_TIME=${config.MAX_RESPONSE_TIME}
MAX_ERROR_RATE=${config.MAX_ERROR_RATE}

# Reporting
SCREENSHOT_ON_FAILURE=${config.SCREENSHOT_ON_FAILURE}
VIDEO_RECORDING=${config.VIDEO_RECORDING}
HAR_RECORDING=${config.HAR_RECORDING}

# Environment
NODE_ENV=${config.NODE_ENV}
`;
  
  fs.writeFileSync('.env', envContent);
  logSuccess('Environment file (.env) created successfully');
}

async function verifyTypeScriptCompilation() {
  logStep('5', 'Verifying TypeScript compilation...');
  
  try {
    execSync('npx tsc --noEmit', { stdio: 'pipe' });
    logSuccess('TypeScript compilation successful');
  } catch (error) {
    logError('TypeScript compilation failed');
    log('Please check for TypeScript errors and run the setup again');
    process.exit(1);
  }
}

async function runHealthCheck() {
  logStep('6', 'Running framework health check...');
  
  try {
    // Test basic browser launch with a simple page
    log('Testing browser launch and basic navigation...');
    
    const healthCheckScript = `
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Test basic navigation to a simple data URL
  await page.goto('data:text/html,<h1>Xyne Framework Health Check</h1><p>Setup successful!</p>');
  
  // Verify page loaded
  const title = await page.textContent('h1');
  if (title !== 'Xyne Framework Health Check') {
    throw new Error('Health check failed: Page content mismatch');
  }
  
  await browser.close();
  console.log(' Browser health check passed');
})();
`;
    
    fs.writeFileSync('temp-health-check.js', healthCheckScript);
    execSync('node temp-health-check.js', { stdio: 'inherit' });
    fs.unlinkSync('temp-health-check.js');
    
    logSuccess('Framework health check passed');
  } catch (error) {
    logError('Framework health check failed');
    logError(error.message);
    process.exit(1);
  }
}

async function runVerificationTest() {
  logStep('7', 'Running verification test...');
  
  try {
    log('Running smoke tests to verify setup...');
    execSync('npm run test:smoke:headless', { stdio: 'inherit' });
    logSuccess('Verification test passed');
  } catch (error) {
    logWarning('Verification test failed (this may be due to network connectivity)');
    log('The framework setup is complete, but the test site may not be accessible');
    log('You can still use the framework for testing other applications');
  }
}

async function showSuccessMessage() {
  log('\n' + '='.repeat(60));
  log(colors.green + colors.bright + '🎉 SETUP COMPLETE! 🎉' + colors.reset);
  log('='.repeat(60));
  
  log('\n' + colors.bright + 'Your Xyne TypeScript Automation Framework is ready!' + colors.reset);
  
  log('\n' + colors.yellow + '📋 Quick Start Commands:' + colors.reset);
  log('  npm test                    # Run tests (Chromium, headed)');
  log('  npm run test:chromium       # Chromium browser, headed mode');
  log('  npm run test:chromium:headless  # Chromium browser, headless mode');
  log('  npm run test:smoke          # Smoke tests only');
  log('  npm run test:firefox        # Firefox browser');
  log('  npm run test:webkit         # WebKit browser');
  log('  npm run test:cross-browser  # All browsers');
  
  log('\n' + colors.yellow + '🛠️  Useful Scripts:' + colors.reset);
  log('  node run-basic-test.js      # Run basic navigation test');
  log('  npm run test:debug          # Debug mode');
  log('  npx playwright show-report  # View test reports');
  
  log('\n' + colors.yellow + '📚 Documentation:' + colors.reset);
  log('  README.md                   # Framework documentation');
  log('  BROWSER_CONTROL_GUIDE.md    # Browser control guide');
  log('  SETUP.md                    # Setup instructions');
  
  log('\n' + colors.yellow + '🔧 Configuration:' + colors.reset);
  log('  .env                        # Environment variables');
  log('  playwright.config.ts        # Playwright configuration');
  
  log('\n' + colors.green + 'Happy Testing! 🚀' + colors.reset);
  log('='.repeat(60) + '\n');
}

async function main() {
  log('\n' + '='.repeat(60));
  log(colors.cyan + colors.bright + '🚀 Xyne TypeScript Automation Framework Setup' + colors.reset);
  log('='.repeat(60));
  log('\nThis script will set up everything you need to start testing with the framework.\n');
  
  try {
    await checkNodeVersion();
    await installDependencies();
    await installPlaywrightBrowsers();
    await setupEnvironmentFile();
    await verifyTypeScriptCompilation();
    await runHealthCheck();
    await runVerificationTest();
    await showSuccessMessage();
  } catch (error) {
    logError(`Setup failed: ${error.message}`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  log('\n\n' + colors.yellow + 'Setup interrupted by user' + colors.reset);
  rl.close();
  process.exit(1);
});

main();
