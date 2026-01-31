# Xyne Automation Framework

Complete TypeScript test automation framework for the Xyne AI-first Search & Answer Engine. Built with Playwright, featuring advanced LLM testing, network monitoring, and authentication handling.

## 🚀 Quick Start (2 minutes)

```bash
# 1. Clone and setup
git clone git@github.com:amrit-raaj-juspay/xyne-automation.git
cd xyne-automation
npm run setup:complete

# 2. Configure environment
cp .env.example .env
# Edit .env with your credentials

# 3. Run first test
npm run test:smoke
```

## 📁 Project Structure

```
xyne-automation/
├── src/framework/
│   ├── core/                     # BasePage, ConfigManager, Global Setup
│   ├── pages/                    # LoginPage, GoogleOAuthLoginPage, etc.
│   └── utils/                    # NetworkAnalyzer, LLMEvaluator, TOTPGenerator
├── tests/
│   ├── functional/               # Main feature tests
│   ├── smoke/                    # Quick validation tests
│   └── integration/              # End-to-end tests
├── config/local.yaml             # Test configuration
├── playwright.config.ts          # Playwright settings
└── docs/                        # Complete documentation
```

## 🧪 Writing Tests

### Basic Test Pattern
```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../src/framework/pages/login-page';

test('validate login page', async ({ page }) => {
  const loginPage = new LoginPage(page);
  
  await loginPage.navigate();
  const isLoaded = await loginPage.isPageLoaded();
  expect(isLoaded).toBe(true);
  
  console.log('✅ Test completed');
});
```

### Page Object Usage
```typescript
// ✅ Always use page objects
const loginPage = new LoginPage(page);
await loginPage.clickGoogleLogin();

// ❌ Never use direct Playwright in tests
await page.click('text=Login with Google');
```

## 🔧 Key Framework Classes

### BasePage (Foundation)
```typescript
export class MyPage extends BasePage {
  async performAction(): Promise<void> {
    await this.clickElement('button');           // Click elements
    await this.fillElement('#input', 'text');   // Fill inputs
    await this.waitForElement('.result');       // Wait for elements
    const text = await this.getElementText('.msg'); // Get text
    await this.takeScreenshot('debug.png');     // Screenshots
  }
}
```

### ConfigManager (Settings)
```typescript
import { configManager } from '../core/config-manager';

const baseUrl = configManager.getBaseUrl();
const config = configManager.getConfig();
```

### NetworkAnalyzer (API Monitoring)
```typescript
import { NetworkAnalyzer } from '../utils/network-analyzer';

const analyzer = new NetworkAnalyzer();
page.on('request', request => analyzer.addRequest(request));
page.on('response', response => analyzer.addResponse(response));

const metrics = analyzer.getPerformanceMetrics();
const failedCalls = analyzer.getFailedAPICalls();
```

### LLMEvaluator (AI Testing)
```typescript
import { LLMEvaluator } from '../utils/llm-evaluator';

const evaluator = LLMEvaluator.createSimpleEvaluator();
const evaluation = await evaluator.evaluateResponse(
  'What is AI?',
  aiResponse,
  ['artificial', 'intelligence', 'machine']
);

expect(evaluation.overallScore).toBeGreaterThan(0.7);
```

### LoginHelper (Authentication)
```typescript
import { LoginHelper } from '../pages/login-helper';

await LoginHelper.performLogin(page, {
  email: process.env.GOOGLE_EMAIL!,
  password: process.env.GOOGLE_PASSWORD!,
  totpSecret: process.env.TOTP_SECRET_KEY!
});
```

## 🎮 Running Tests

```bash
# Basic commands
npm test                          # All tests (headed)
npm run test:chromium:headless    # Headless mode
npm run test:debug               # Debug mode

# Specific tests
npm run test:login               # Login tests
npm run test:chat                # Chat functionality
npm run test:smoke               # Smoke tests

# Authentication tests (single worker to avoid conflicts)
npm run test:google-login        # Google OAuth + TOTP
npm run test:single              # Any test with single worker

# Cross-browser
npm run test:firefox             # Firefox
npm run test:webkit              # Safari/WebKit
npm run test:cross-browser       # All browsers
```

## ⚙️ Configuration

### Environment Variables (.env)
```env
# Application URLs
XYNE_BASE_URL=https://xyne.juspay.net
XYNE_AUTH_URL=https://xyne.juspay.net/auth

# Authentication
GOOGLE_EMAIL=your_test_email@gmail.com
GOOGLE_PASSWORD=your_test_password
TOTP_SECRET_KEY=your_totp_secret_key

# LLM Testing (optional)
OPENAI_API_KEY=your_openai_api_key

# Test Settings
HEADLESS=false
BROWSER=chromium
```

### Test Configuration (config/local.yaml)
```yaml
# Browser settings
browser:
  type: "chromium"
  headless: false

# Screen size
viewport:
  width: 1920
  height: 1080

# Timeouts (milliseconds)
timeout:
  action: 30000
  navigation: 30000
  test: 60000

# LLM evaluation
llm:
  openaiApiKey: "${OPENAI_API_KEY}"
  model: "gpt-4"
  similarityThreshold: 0.7
```

## 🌟 Advanced Features

### Network Monitoring
```typescript
test('monitor API performance', async ({ page }) => {
  const analyzer = new NetworkAnalyzer();
  
  page.on('request', request => analyzer.addRequest(request));
  page.on('response', response => analyzer.addResponse(response));
  
  // Perform test actions
  await page.goto('/chat');
  await page.fill('#input', 'Hello');
  await page.click('#send');
  
  // Analyze results
  const metrics = analyzer.getPerformanceMetrics();
  expect(metrics.errorCount).toBe(0);
  expect(metrics.averageResponseTime).toBeLessThan(2000);
});
```

### LLM Response Testing
```typescript
test('evaluate AI response quality', async ({ page }) => {
  const evaluator = LLMEvaluator.createComprehensiveEvaluator();
  
  // Get AI response
  await page.goto('/chat');
  await page.fill('#input', 'Explain machine learning');
  await page.click('#send');
  const response = await page.textContent('.response');
  
  // Evaluate quality
  const evaluation = await evaluator.evaluateResponse(
    'Explain machine learning',
    response!,
    ['algorithm', 'data', 'model', 'training']
  );
  
  expect(evaluation.overallScore).toBeGreaterThan(0.7);
  expect(evaluation.semanticSimilarity?.score).toBeGreaterThan(0.6);
});
```

### TOTP Authentication
```typescript
import { TOTPGenerator } from '../utils/totp-generator';

test('generate TOTP codes', async ({ page }) => {
  const totp = new TOTPGenerator(process.env.TOTP_SECRET_KEY!);
  
  const code = totp.generateCurrentCode();
  console.log('Generated TOTP:', code);
  
  // Wait for new code if current one expires soon
  if (totp.isNearExpiration()) {
    await totp.waitForNewCodeIfNeeded();
  }
});
```

## 🔍 Debugging

### Screenshots & Logs
```typescript
test('debug example', async ({ page }) => {
  console.log('🚀 Starting test');
  
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  
  // Take screenshot for debugging
  await loginPage.takeScreenshot('debug-login.png');
  
  console.log('📍 Current URL:', page.url());
});
```

### Debug Mode
```bash
# Opens browser with dev tools
npm run test:debug tests/functional/my-test.spec.ts
```

### Network Debugging
```typescript
test('debug network', async ({ page }) => {
  page.on('request', req => console.log('📤', req.method(), req.url()));
  page.on('response', res => console.log('📥', res.status(), res.url()));
  
  await page.goto('/');
});
```

## 📊 Reports

```bash
# View HTML report
npm run report

# Reports saved to:
reports/
├── screenshots/     # Test screenshots
├── videos/         # Test recordings (if enabled)
├── traces/         # Playwright traces
└── html-report/    # Detailed HTML report
```

## 🎯 Best Practices

1. **Use Page Objects** - Never write Playwright code directly in tests
2. **Descriptive Names** - `test('should login with valid credentials')` not `test('test1')`
3. **Proper Waits** - Use `waitForElement()` not `waitForTimeout()`
4. **Console Logs** - Add logs for debugging: `console.log('✅ Login successful')`
5. **Screenshots** - Take screenshots for complex debugging scenarios

## 🆘 Common Issues & Solutions

### Setup Problems
```bash
# Node.js too old
nvm install 18 && nvm use 18

# Browsers not installed
npx playwright install

# Dependencies issues
rm -rf node_modules && npm install
```

### Test Failures
```bash
# Timeout issues - increase in config/local.yaml
timeout:
  navigation: 60000

# Element not found - add proper waits
await page.waitForElement('selector');
```

### Authentication Issues
```bash
# TOTP problems - sync system time
sudo sntp -sS time.apple.com  # macOS

# Credentials - verify .env file
GOOGLE_EMAIL=correct_email@gmail.com
```

## 📚 Documentation

This README contains everything you need to get started and use the framework effectively. All essential information is included above:

- **Quick Start** - 2-minute setup guide
- **Writing Tests** - Complete examples and patterns
- **Framework Classes** - All key components with code examples
- **Configuration** - Environment and test settings
- **Advanced Features** - LLM testing, network monitoring, authentication
- **Debugging** - Tools and techniques for troubleshooting
- **Best Practices** - Coding standards and recommendations

## 🔧 Framework Features

### Core Capabilities
- **Cross-browser Testing** - Chromium, Firefox, WebKit
- **Page Object Model** - Structured, maintainable test code
- **Configuration Management** - Environment-specific settings
- **Global Setup/Teardown** - Automated test environment management

### Advanced Testing
- **LLM Response Evaluation** - AI-powered response quality assessment
- **Network Monitoring** - Real-time API call analysis and performance metrics
- **TOTP Authentication** - Time-based two-factor authentication support
- **Performance Testing** - Built-in response time and error rate monitoring

### Developer Experience
- **TypeScript Support** - Full type safety and IntelliSense
- **Comprehensive Reporting** - HTML reports with screenshots and traces
- **Debug Mode** - Browser debugging with developer tools
- **Screenshot Capture** - Automatic failure screenshots and manual capture

## 🤝 Contributing

1. Follow the Page Object Model pattern
2. Add tests for new functionality
3. Update documentation for new features
4. Use TypeScript for all code
5. Follow existing code style and naming conventions

---

**Ready to start testing?** Run `npm run setup:complete` and then `npm run test:smoke` to verify everything works!
