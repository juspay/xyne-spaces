# Xyne TypeScript Automation Framework Setup Guide

## Prerequisites

This TypeScript automation framework requires Node.js and npm to be installed on your system.

### Installing Node.js and npm

#### Option 1: Using Homebrew (Recommended for macOS)
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js (includes npm)
brew install node
```

#### Option 2: Using Node Version Manager (nvm)
```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Restart terminal or source the profile
source ~/.zshrc

# Install latest LTS Node.js
nvm install --lts
nvm use --lts
```

#### Option 3: Direct Download
Visit [nodejs.org](https://nodejs.org/) and download the LTS version for your operating system.

### Verify Installation
```bash
node --version
npm --version
```

## Framework Installation

Once Node.js and npm are installed:

```bash
# Navigate to the TypeScript framework directory
cd xyne-automation-ts

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install

# Verify TypeScript compilation
npx tsc --noEmit

# Run a quick test to verify setup
npx playwright test --reporter=list
```

## Environment Setup

1. Copy the environment template:
```bash
cp .env.example .env
```

2. Update the `.env` file with your configuration:
```env
# Xyne Application URLs
XYNE_BASE_URL=https://xyne.juspay.net
XYNE_AUTH_URL=https://xyne.juspay.net/auth

# Test Configuration
TEST_TIMEOUT=30000
HEADLESS=true
BROWSER=chromium

# LLM Evaluation (Optional)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4

# Logging
LOG_LEVEL=info
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm run test:chat

# Run tests in headed mode (browser visible)
npm run test:headed

# Run tests with debug output
npm run test:debug

# Generate test report
npm run test:report
```

## Framework Structure

```
xyne-automation-ts/
├── src/
│   ├── framework/
│   │   ├── core/           # Core framework components
│   │   ├── pages/          # Page Object Models
│   │   └── utils/          # Utility functions
│   └── types/              # TypeScript type definitions
├── tests/
│   ├── functional/         # Functional tests
│   ├── integration/        # Integration tests
│   └── smoke/             # Smoke tests
├── reports/               # Test reports and artifacts
└── config/               # Configuration files
```

## Troubleshooting

### Common Issues

1. **TypeScript compilation errors**: Ensure all dependencies are installed with `npm install`
2. **Playwright browser issues**: Run `npx playwright install` to download browsers
3. **Environment variables**: Verify `.env` file is properly configured
4. **Network issues**: Check firewall settings and proxy configuration

### Getting Help

- Check the test logs in `reports/` directory
- Run tests with `--debug` flag for verbose output
- Ensure Xyne application is accessible from your network
