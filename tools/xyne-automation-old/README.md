# Xyne Automation

Automation testing framework for Xyne Spaces, built with [Playwright](https://playwright.dev/) and [Cucumber](https://cucumber.io/) (BDD).

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running Tests](#running-tests)
  - [Playwright Tests](#playwright-tests)
  - [Cucumber (BDD) Tests](#cucumber-bdd-tests)
- [Project Structure](#project-structure)
- [Reports](#reports)

## Overview

This repository contains automated tests for the Xyne Spaces application, covering:

- **API Tests**: Validating backend endpoints.
- **UI Tests**: Testing frontend user interfaces.
- **E2E Tests**: End-to-end user flows.

The framework supports multiple environments (`local`, `test`, `sbx`, `prod`) and allows for flexible configuration.

## Tech Stack

- **Language**: TypeScript
- **Core Framework**: Playwright
- **BDD Framework**: Cucumber
- **Assertions**: Chai / Playwright assertions
- **HTTP Client**: Axios (for API steps)
- **Environment Management**: dotenv

## Prerequisites

- **Node.js**: v18 or higher recommended
- **npm**: v9 or higher

## Installation

1.  **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd xyne-automation
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Install Playwright browsers:**
    ```bash
    npx playwright install
    ```

## Configuration

1.  **Create your environment file:**
    Copy the example configuration file to create your local `.env` file.

    ```bash
    cp .env.example .env
    ```

2.  **Configure `.env`:**
    Open `.env` and set the `TEST_ENV` variable. This controls the default URLs and settings used by the tests.

    ```env
    # Options: local, test, sbx, prod
    TEST_ENV=local
    ```

    You can also override specific settings like URLs, browser type, and headless mode:

    ```env
    # Optional Overrides
    BROWSER=chromium      # chromium, firefox, webkit
    HEADLESS=false        # true, false

    # Service URLs
    BACKEND_URL=http://localhost:3001
    DASHBOARD_URL=http://localhost:5173

    # Test Execution
    RETRIES=0             # Number of retries for failed scenarios
    TIMEOUT=30000         # Global test timeout in milliseconds
    ```

## Running Tests

### Running Tests

These scripts run Cucumber scenarios defined in `.feature` files. You can filter tests using **tags**.

- **Run all tests:**

  ```bash
  npm run test
  ```

- **Run specific suites (using tags):**

  ```bash
  # Runs scenarios tagged with @api
  npm run test:api

  # Runs scenarios tagged with @ui
  npm run test:ui

  # Runs scenarios tagged with @e2e
  npm run test:e2e
  ```

- **Debug mode:**
  Runs with the Node.js inspector enabled, allowing you to attach a debugger.
  ```bash
  npm run test:debug
  ```

## Project Structure

```
xyne-automation/
├── config/                 # Environment-specific configurations (URLs, timeouts)
├── fixtures/               # Test fixtures and global hooks
│   ├── cucumber.hooks.ts   # Global setup/teardown (Before/After hooks)
│   ├── cucumber.world.ts   # Custom World for sharing state between steps
│   └── base.fixture.ts     # Playwright fixture setup
├── lib/                    # Shared libraries and API clients
├── tests/
│   ├── api/                # API tests (features, steps, specs)
│   ├── e2e/                # End-to-end tests
│   ├── ui/                 # UI component tests
│   └── shared/             # Reusable step definitions
│       ├── common.steps.ts # Common actions and assertions
│       └── browser.steps.ts # Browser session management steps
├── report/                 # Test reports (auto-generated)
├── .env.example            # Example environment file
├── cucumber.js             # Cucumber configuration
├── playwright.config.ts    # Playwright configuration
└── package.json            # Project scripts and dependencies
```

## Architecture & Common Patterns

- **Shared Steps**: Common actions (like "I am on the login page" or "I request the health endpoint") are defined in `tests/shared/common.steps.ts` to avoid code duplication across different feature files.
- **Fixtures & World**:
  - `fixtures/cucumber.world.ts`: Defines the `CustomWorld` class, which maintains state (like `apiResponse`, `page` object) across steps in a scenario.
  - `fixtures/cucumber.hooks.ts`: Contains global `Before` and `After` hooks to handle browser context creation and cleanup.

## Browser Session Management

The framework supports **named browser sessions** that persist across scenarios within a feature file. This is useful for E2E and UI tests where you want to maintain browser state.

### Creating a Browser Session

```gherkin
Scenario: Setup browser session
  Given a browser "my-browser" with viewport "1920x1080"
```

### Using a Browser Session

```gherkin
Scenario: Perform some action
  Given using browser "my-browser"
  When I do something
  Then I should see something
```

### Closing a Browser Session

```gherkin
Scenario: Cleanup browser session
  Given close the browser "my-browser"
```

### Key Points

- **Persistence**: Browser sessions persist across scenarios within a feature file, allowing you to reuse the same browser context.
- **Custom Viewports**: Specify viewport dimensions when creating a session (e.g., `"1920x1080"`).
- **Multiple Sessions**: You can create multiple named sessions and switch between them using `using browser "name"`.
- **Global Browser**: A single Playwright browser instance is shared globally and launched once in `BeforeAll`, then closed in `AfterAll`.
- **Reports**:
  - **Cucumber Report**: A self-contained HTML report is generated at `report/cucumber-report.html`.
  - **Playwright Report**: A detailed trace report is available via `npm run report`.

## Reports

After running tests, you can view the results:

1.  **Cucumber HTML Report**:
    Open `report/cucumber-report.html` in your browser for a summary of scenarios and steps.

2.  **Playwright Trace Report**:
    For detailed debugging (traces, screenshots), run:
    ```bash
    npm run report
    ```

To clean old reports:

```bash
npm run clean
```
