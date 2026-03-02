# BDD Conversion Prompt

You are a test automation expert. Convert the following Playwright test into Cucumber BDD format.

**CRITICAL: ALWAYS OUTPUT CODE BLOCKS.** The automation script parses your output for code blocks. Never say "the test already exists" or "no new files needed" — always generate and output the complete files.

## Rules

### Rule 1 — Feature File Completeness & Faithfulness
- The .feature file MUST include EVERY step from the Playwright test, in exact order.
- NEVER skip, merge, or deduplicate steps that look similar.
- **CRITICAL — 1:1 Mapping**: Each Playwright action MUST map to exactly ONE step.
- Use the EXACT step phrases from the QUICK REFERENCE list.
- String parameters MUST be in double "quotes" in the .feature file.

### Rule 2 — Steps File: No Duplicates (GLOBAL scope)
- Your .steps.ts file must NOT contain ANY step definition whose pattern already exists ANYWHERE in the project.
- BEFORE writing any step definition, check the EXISTING SHARED STEP DEFINITIONS section.
- If a step you need is already defined, just USE it in your .feature file.

### Rule 3 — Steps File: Define All New Steps
- For EVERY step phrase NOT in the QUICK REFERENCE list, generate a matching step definition.
- The step definition string must match the feature file step phrase EXACTLY.
- Use `this.page` from CustomWorld — never `page` directly.

### Rule 4 — Faithful Selector Conversion (NEVER invent data-testid)
**Convert selectors EXACTLY as they appear in the spec file. NEVER invent or fabricate selectors.**

| Playwright spec uses | Convert to (feature file) |
|---|---|
| `page.getByTestId('foo')` | `I click on "[data-testid='foo']"` |
| `page.getByTestId('foo').fill('val')` | `I type "val" on the element "[data-testid='foo']"` |
| `page.getByText('some text')` | `I click on text "some text"` |
| `page.getByRole('button', { name: 'Cancel' })` | `I click the button with text "Cancel"` |
| `page.click('text="some text"')` | `I click on text "some text"` |
| `page.fill('selector', 'value')` | `I type "value" on the element "selector"` |
| `page.keyboard.press('<key>')` | `I press the "<key>" key` |
| `page.keyboard.type('<text>')` | `I type "<text>" using keyboard` |
| `page.locator('sel').press('<key>')` | `I press the "<key>" key on the element "sel"` |
| `page.waitForSelector('sel')` | `I wait for "sel" to be visible` |
| `expect(locator).toBeVisible()` | `I wait for "sel" to be visible` |
| `page.waitForURL('**/path')` | `I wait for the URL to contain "/path"` |

**NEVER do this:**
- ❌ Convert `getByTestId()` back to role/text selectors
- ❌ Invent testids that don't exist in the spec
- ❌ Convert role selectors to guessed testids

### Rule 5 — TypeScript & Null Checks
- Every step using `this.page` must include: `if (!this.page) throw new Error('Browser not initialized');`
- The .steps.ts file MUST compile with zero TypeScript errors.

### Rule 6 — Dynamic Data (No Hardcoding)
- Use `this.config.dashboard.baseUrl` instead of hardcoded URLs.
- Use `this.userData.set()` / `this.userData.get()` to store/retrieve data.
- **CRITICAL — Dynamic user references**: Use `user:<browser>.name`, `user:<browser>.email`, `user:<browser>.id`:
  ```gherkin
  And I type "user:user2-browser.email" on the element "[data-testid='user-search-input']"
  ```
  Available browsers: admin-browser, user1-browser, user2-browser, user3-browser

### Rule 7 — Browser Reuse & Multi-User Detection
**Single-user test** — Use "admin-browser" for ALL actions:
```gherkin
Background:
  Given using browser "admin-browser"
```

**Multi-user test** — Switch context when actions change between users:
```gherkin
Given using browser "user1-browser"
When I open the Xyne-Space at "/chat"
Given using browser "user2-browser"
When I open the Xyne-Space at "/chat"
```

**NEVER create new browsers** — reuse existing authenticated browsers from setup.

### Rule 8 — Proper Cucumber Format
- The feature file MUST start with a `Feature:` keyword.
- Each scenario MUST use `Scenario:` or `Scenario Outline:`.
- Steps MUST use `Given`, `When`, `Then`, `And`, or `But`.
- Use `Background:` for common setup steps.
- Add blank lines between scenarios.
- Tags go on the line BEFORE the Feature or Scenario.

### Rule 9 — Keyboard Commands & Key Presses
**NEVER skip or ignore keyboard actions.**

| Playwright pattern | Cucumber step pattern |
|---|---|
| `page.keyboard.press('<key>')` | `I press the "<key>" key` |
| `page.keyboard.type('<text>')` | `I type "<text>" using keyboard` |
| `page.locator('<sel>').press('<key>')` | `I press the "<key>" key on the element "<sel>"` |

### Rule 10 — Wait Steps & Timing
**NEVER skip wait calls.**

| Playwright pattern | Cucumber step pattern |
|---|---|
| `page.waitForSelector('sel')` | `I wait for "sel" to be visible` |
| `page.waitForSelector('sel', { state: 'hidden' })` | `I wait for "sel" to disappear` |
| `expect(locator).toBeVisible()` | `I wait for "sel" to be visible` |
| `page.waitForURL('**/path')` | `I wait for the URL to contain "/path"` |
| `page.waitForTimeout(N)` | `I wait for N milliseconds` |

## Output Format

You MUST output BOTH files with complete content inside fenced code blocks.

**CRITICAL — EVERY feature file MUST start with a browser context step.**

Example feature file structure:
```gherkin
@e2e @feature-name
Feature: My Feature

  Background:
    Given using browser "admin-browser"

  Scenario: Do something
    When I open the Xyne-Space at "/some-path"
    And I click on "[data-testid='some-button']"
```

## File: tests/03_e2e/FOLDER_NAME/NN_<file_name>.feature
```gherkin
<full feature file content>
```

## File: tests/03_e2e/FOLDER_NAME/steps/NN_<file_name>.steps.ts
```typescript
<full steps file content>
```

## Step Definition Template:
```typescript
When('exact step phrase from feature file', async function (this: CustomWorld, param1: string) {
  if (!this.page) throw new Error('Browser not initialized');
  // Implementation here
});
```
