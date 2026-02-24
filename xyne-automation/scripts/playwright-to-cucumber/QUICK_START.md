# Quick Start Guide - Playwright to Cucumber Conversion

This guide explains how to convert Playwright test files to Cucumber BDD format using Claude Code with Juspay Grid.

## 1. Prerequisites

### Required Tools

- **Node.js** (v18 or higher) and npm
- **Claude Code** CLI tool

### Setup (One-time)

```bash
cd xyne-automation

# Install Claude Code (Required)
brew install --cask claude-code

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install
```

### Configuration

1. **Create environment file:**

```bash
cp .env.example .env
```

2. **Configure `.env`:**

```env
# Test environment: local, test, sbx, or prod
TEST_ENV=local

# Juspay Grid API Configuration (required for conversion)
JUSPAY_API_KEY=your_api_key_here

# Optional service URLs
BACKEND_URL=http://localhost:3001
DASHBOARD_URL=http://localhost:5173
```

## 2. Quick Start - Convert and Run Tests

The **`npm run codegen-and-test`** command is the main workflow that provides a complete pipeline:

1. **Converts** Playwright specs to Cucumber BDD format
2. **Validates** generated files with dry-run checks
3. **Runs** the Cucumber tests automatically

This is the recommended approach for a streamlined test development cycle.

**Where to find Playwright spec files:**
Recorded Playwright spec files are typically stored in `tests/Actions/` folder. This is where you should place any Playwright tests recorded using Playwright Codegen or manually written Playwright specs that you want to convert to Cucumber BDD format.

### Convert and run a single Playwright spec file:

```bash
npm run codegen-and-test -- tests/Actions/create-dashboard.spec.ts
```

### Convert and run multiple spec files:

```bash
npm run codegen-and-test -- tests/Actions/create-dashboard.spec.ts tests/Actions/thread.spec.ts
```

### Using relative paths:

```bash
npm run codegen-and-test -- ../tests/test1.spec.ts
```

**What happens when you run codegen-and-test:**

1. **Step 1 - Conversion**: Each spec file is converted to BDD format
2. **Step 2 - Validation**: Generated files are validated with dry-run checks
   - If undefined steps are found, a detailed report is saved to `xyne-automation/llm_reports/dry_run`
   - Automatic retry attempts to fix conversion issues
3. **Step 3 - Execution**: All E2E tests are run using `npm run test:e2e`

**Failed Dry Run Reports:**
If validation fails, detailed reports are saved in `xyne-automation/llm_reports/dry_run`:

- Contains the dry run output showing undefined steps
- Includes the feature file and steps file content
- Provides suggested fixes for resolving issues

View a failed report:

```bash
cat xyne-automation/llm_reports/dry_run/<file_name>_failed_dry_run_<timestamp>.txt
```

## 2.5 Alternative - Convert Only

If you only want to convert Playwright specs without running tests, use `npm run codegen`. This command:

- Verifies Claude Code installation (requires manual installation)
- Uses Juspay Grid API (via Claude Code) to convert Playwright tests
- Generates feature files and step definitions
- Places them in the correct directory structure

### Convert a single Playwright spec file:

```bash
npm run codegen -- tests/Actions/create-dashboard.spec.ts
```

### Convert multiple spec files:

```bash
npm run codegen -- tests/Actions/test1.spec.ts tests/Actions/test2.spec.ts
```

### Convert using glob patterns:

```bash
npm run codegen -- tests/Actions/*.spec.ts
```

### Convert from a different directory:

```bash
npm run codegen -- path/to/your/test.spec.ts
```

**Note:** After conversion, you can manually run tests using the commands in [Section 4 - Running Converted Tests](#4-running-converted-tests).

## 3. Output Structure

Converted tests are automatically organized in the `tests/` directory:

```
tests/
├── 01_api/                  # API tests
├── 02_ui/                   # UI component tests
├── 03_e2e/                  # End-to-end tests
│   ├── 01_first-test/       # Numbered test folder
│   │   ├── 01_first-test.feature
│   │   └── steps/
│   │       └── 01_first-test.steps.ts
│   └── 07_create-dashboard/
│       ├── 01_create-dashboard.feature
│       └── steps/
│           └── 01_create-dashboard.steps.ts
└── shared/                  # Reusable step definitions
    ├── common.steps.ts      # Common actions and assertions
    └── browser.steps.ts     # Browser session management
```

### Naming Convention

- **Test Folders**: `NN_<test-name>` (e.g., `07_create-dashboard`)
- **Feature Files**: `01_<test-name>.feature` (in the test folder root)
- **Step Definition Files**: `01_<test-name>.steps.ts` (in `steps/` subfolder)

The script automatically:

- Assigns the next available number prefix to new test folders
- Ensures feature and steps files are correctly named
- Creates a `steps/` subfolder within each test folder
- Places step definitions in `tests/03_e2e/NN_test-name/steps/01_test-name.steps.ts`
- Avoids creating duplicate step definitions

## 4. Running Converted Tests

After conversion, run the Cucumber tests:

### Run all tests:

```bash
npm run test
```

### Run specific suites (using tags):

```bash
# Run API tests
npm run test:api

# Run UI tests
npm run test:ui

# Run E2E tests
npm run test:e2e
```

### Debug mode:

```bash
npm run test:debug
```

## 5. Next Steps

1. **Review generated files**: Check the `.feature` files for correct Gherkin syntax
2. **Verify step definitions**: Ensure the `.steps.ts` files match the feature steps
3. **Check for undefined steps**: If Cucumber reports undefined steps, add them to the step definition file
4. **Test locally**: Run the converted tests to ensure they work correctly
5. **Consolidate duplicates**: Review step definitions and consolidate common steps into `tests/shared/`

## 6. Conversion Details

### What Gets Generated

- **`.feature` file**: Contains scenarios in Gherkin syntax with appropriate tags
- **`.steps.ts` file**: Contains TypeScript step definitions matching the feature steps

### Smart Conversion Features

The conversion process:

- **Reuses existing steps**: Checks `tests/shared/common.steps.ts` and `tests/shared/browser.steps.ts` before creating new step definitions
- **Uses dynamic data**: Avoids hardcoding user names, test strings, and other application data
- **Follows naming conventions**: Maintains consistency with existing test structure
- **Respects existing tests**: Extends existing test suites instead of creating duplicates
- **Supports browser sessions**: Uses existing browser sessions (admin-browser, user1-browser, etc.) when applicable

### Common Patterns Used

```gherkin
Feature: Create Dashboard

  @e2e @dashboard
  Scenario: Create a new dashboard
    Given using browser "admin-browser"
    When I navigate to the dashboard page
    And I click on the "New Dashboard" button
    Then I should see the dashboard creation modal
```

## 7. Troubleshooting

### Claude Code Installation Issues

Claude Code must be installed manually. If found missing, the script will exit with instructions.

To install or reinstall:

```bash
brew install --cask claude-code
```

### API Key Issues

Ensure your `JUSPAY_API_KEY` is set in `.env`:

```env
JUSPAY_API_KEY=your_api_key_here
```

Note: Do not include "Bearer" prefix in the `.env` file.

### Undefined Steps

If Cucumber reports undefined steps after conversion:

1. Check the feature file for exact step phrasing
2. Ensure the step definition regex matches the feature step exactly
3. Add any missing step definitions to the `.steps.ts` file

### File Not Found Errors

The script tries multiple path locations for input files:

- Relative path from current directory
- Relative to `xyne-automation/tests/`
- Relative to `xyne-automation/`

If still not found, use an absolute path.

## 8. Advanced Usage

### Running with Different Tags

You can run specific scenarios using Cucumber tags:

```bash
npx cucumber-js --tags '@dashboard'
npx cucumber-js --tags '@e2e and @critical'
npx cucumber-js --tags 'not @skip'
```

### Viewing Reports

After running tests, view the reports:

```bash
# Open Cucumber HTML report
open report/cucumber-report.html

# Or use the report command
npm run report
```

### Cleaning Up

Remove old test reports:

```bash
npm run clean
```

## Need More Information?

- **Main Documentation**: See [../../README.md](../../README.md) for full framework documentation
- **Project Structure**: Refer to the main README for detailed architecture
- **Cucumber Docs**: [https://cucumber.io/docs/cucumber/](https://cucumber.io/docs/cucumber/)
- **Playwright Docs**: [https://playwright.dev/](https://playwright.dev/)
