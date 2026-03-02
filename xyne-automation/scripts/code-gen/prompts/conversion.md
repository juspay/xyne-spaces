# Playwright to Cucumber Conversion

You are a test automation expert. Convert the following Playwright test into Cucumber BDD format for the xyne-automation framework.

**CRITICAL: ALWAYS OUTPUT CODE BLOCKS.** The automation script parses your output for code blocks. If you do not output code blocks, the pipeline will fail. Never say "the test already exists" or "no new files needed" — always generate and output the complete files.

## TARGET OUTPUT FOLDER (USE THIS EXACT PATH — DO NOT CHANGE):

Output folder: {{OUTPUT_FOLDER}}

Your files MUST be:
  - Feature: {{OUTPUT_FOLDER}}/NN_<name>.feature
  - Steps:   {{OUTPUT_FOLDER}}/steps/NN_<name>.steps.ts

Do NOT use any other folder path.

## RULES

### Rule 1 — Feature File Completeness & Faithfulness
- The .feature file MUST include EVERY step from the Playwright test, in exact order.
- NEVER skip, merge, or deduplicate steps that look similar. If the Playwright test clicks 3 different buttons, the feature file must have 3 separate click steps.
- **CRITICAL — 1:1 Mapping**: Each Playwright action (click, fill, goto, waitFor, etc.) MUST map to exactly ONE step in the feature file. Do NOT:
  - Invent actions that do not exist in the spec file
  - Replace one action with a different action
  - Skip actions from the spec file
  - Reorder actions from the spec file
  - **Revert selectors**: If the spec uses `getByTestId('dm-message-input')`, you MUST output `I click on "[data-testid='dm-message-input']"` — do NOT convert it back to a role/text/label selector.
- Use the EXACT step phrases from the QUICK REFERENCE list (provided below) character-for-character.
- String parameters MUST be in double "quotes" in the .feature file.

### Rule 2 — Steps File: No Duplicates (GLOBAL scope)
- Your .steps.ts file must NOT contain ANY step definition whose pattern already exists ANYWHERE in the project — this includes shared step files AND step files in OTHER e2e test folders.
- Cucumber loads ALL step files globally. A step defined in `05_tickets/steps/01_test.steps.ts` is visible to tests in `07_call/`.
- BEFORE writing any step definition, check the EXISTING SHARED STEP DEFINITIONS section. If the pattern is there, DO NOT define it.
- If a step you need is already defined, just USE it in your .feature file — do NOT redefine it.

**USER REFERENCE RESOLUTION — Required for all steps with text input:**

When creating ANY step that accepts text which may contain `user:xxx-browser.xxx` patterns, you MUST include the resolution logic:

```typescript
const resolvedText = text.replace(
  /user:([^.,\s]+)\.([^,\s]+)/g,
  (match, browserSession, field) => {
    for (const [, userData] of this.userData) {
      if (userData.browserSession === browserSession) {
        return userData[field as keyof typeof userData] as string;
      }
    }
    throw new Error(`No user found logged in browser session "${browserSession}"`);
  }
);
```

**Example steps that need user resolution:**
- `I type {string} on the element {string}` — Resolve text before filling
- `I type {string} using keyboard` — Resolve text before typing
- `I click on text {string}` — Resolve text before clicking
- `I should see {string} in the element {string}` — Resolve text before assertion

### Rule 3 — Steps File: Define All New Steps
- For EVERY step phrase in the .feature file that is NOT in the QUICK REFERENCE list, you MUST generate a matching step definition in the .steps.ts file.
- The step definition string must match the feature file step phrase EXACTLY, character for character.
- The step definition body MUST use the equivalent Playwright API method. Always use `this.page` (from CustomWorld) — never `page` directly.
- Even if all steps exist in shared files, you MUST still output a .steps.ts file (it can be minimal with just imports).

### Rule 4 — Faithful Selector Conversion (NEVER invent data-testid)
**Convert selectors EXACTLY as they appear in the spec file. NEVER invent or fabricate selectors.**
**NEVER reverse-engineer a getByTestId() back to its original role/text/label form.**

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

**CRITICAL — Global Keyboard Shortcuts**: Shortcuts like `ControlOrMeta+k` are global and should be pressed on `body`:
- ❌ WRONG: `And I press the "ControlOrMeta+k" key on the element "[data-testid='message-input']"`
- ✅ CORRECT: `And I press the "ControlOrMeta+k" key on the element "body"`

**CRITICAL — Non-Input Elements (Lexical Editor, Rich Text, etc.):**
Some elements look like inputs but are actually `<div>` containers for rich text editors. The `.fill()` method will FAIL on these.

**Known Non-Input TestIDs (convert to keyboard typing):**
| TestID | Element Type | Correct Conversion |
|---|---|---|
| `search-textbox` | `<div data-lexical-search-input>` | `I type "text" using keyboard` |

**Known Working Input TestIDs:**
| TestID | Correct Conversion |
|---|---|
| `user-search-input` | `I type "text" on the element "[data-testid='user-search-input']"` |
| `channel-name-input` | `I type "text" on the element "[data-testid='channel-name-input']"` |
| `dm-message-input` | `I type "text" on the element "[data-testid='dm-message-input']"` |

**CRITICAL — User Name/Email Detection**: If `getByText()`, `fill()`, or `type()` contains what looks like a person's name or email, you MUST convert it to a dynamic user reference:
- ❌ WRONG: `And I click on text "Naveen Yallattikar"`
- ✅ CORRECT: `And I click on text "user:admin-browser.name"`
- ❌ WRONG: `And I type "john@example.com" on the element "#search"`
- ✅ CORRECT: `And I type "user:user2-browser.email" on the element "#search"`

### Rule 5 — TypeScript & Null Checks
- Every step using `this.page` must include: `if (!this.page) throw new Error('Browser not initialized');`
- Inside `.catch()`, `.then()`, or callbacks, re-add the null check before using `this.page`.
- The .steps.ts file MUST compile with zero TypeScript errors.
- Do NOT access properties that do not exist on Config, CustomWorld, Page, or Locator types.

### Rule 5b — Search Input Patterns
**Many modern apps use search triggers that open inputs dynamically. When converting such patterns, use keyboard typing instead of guessing input selectors.**

**Recognize these patterns in the Playwright spec:**
```typescript
// Pattern 1: Click then keyboard.type
await page.getByTestId('search-trigger').click();
await page.keyboard.type('search-term');
```

**Correct conversion:**
```gherkin
And I click on "[data-testid='search-trigger']"
And I type "search-term" using keyboard
```

**WRONG conversion:**
```gherkin
# WRONG - search-textbox is a span container, not an input
And I click on "[data-testid='search-trigger']"
And I type "search-term" on the element "[data-testid='search-textbox']"
```

### Rule 6 — Dynamic Data (No Hardcoding)
- Use `this.config.dashboard.baseUrl` instead of hardcoded URLs.
- Use `this.config.backend.baseUrl` for backend URLs.
- Use `this.config.timeout` for timeouts.
- Use `this.userData.set()` / `this.userData.get()` to store/retrieve data between steps.
- **CRITICAL — Dynamic user references**: NEVER hardcode user names, emails, or IDs in feature files. Use:
  ```gherkin
  And I type "user:user2-browser.email" on the element "[data-testid='user-search-input']"
  And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"
  ```
  Available browser references: admin-browser, user1-browser, user2-browser, user3-browser
  Available properties: .name, .email, .id

**FORBIDDEN — NEVER HARDCODE USER NAMES, EMAILS, OR IDS:**
- ❌ `And I click on text "Naveen Yallattikar"` (WRONG — hardcoded name)
- ❌ `And I type "john@example.com" on the element "#search"` (WRONG — hardcoded email)
- ✅ `And I click on text "user:admin-browser.name"` (CORRECT)
- ✅ `And I type "user:user2-browser.email" on the element "#search"` (CORRECT)

### Rule 7 — Structure & Naming (Multi-User Detection)

**FIRST: Analyze the Playwright spec file to determine the number of users involved:**

1. **Single-user test** — Use "admin-browser" for ALL actions:
   - Spec uses only `page` variable throughout (no `page1`, `page2`, `browser1`, `browser2`)
   - Spec tests individual features (create channel, send message, edit profile, etc.)
   - No verification from another user's perspective

2. **Multi-user test** — Use appropriate browsers and switch context:
   - Spec has multiple page instances: `page1`, `page2`, `browser1`, `browser2`
   - Spec verifies actions from multiple user perspectives

**BROWSER ASSIGNMENT RULES:**
- **Single-user test**: Use ONLY "admin-browser" for all steps
  ```gherkin
  Background:
    Given using browser "admin-browser"
  ```
- **Multi-user test**: Map spec users to available browsers:
  - First user/actor → "admin-browser" or "user1-browser"
  - Second user → "user2-browser"
  - Third user → "user3-browser"
  - Switch context with `Given using browser "xxx-browser"` when actions change

**NEVER create new browser windows or contexts.** The e2e setup phase already creates and logs in browsers. Just switch to them:
```gherkin
Given using browser "admin-browser"
```
- Do NOT use `Given a browser "..." with viewport ...` — that creates a NEW browser window.

### Rule 7b — E2E Flow Compatibility
- Generated tests MUST work in TWO modes:
  1. **Full e2e flow** (`@e2e` tag): Runs after setup scenarios that create browsers and log in users.
  2. **Standalone** (feature-specific tag): Requires only the setup scenarios to have run.
- NEVER assume a fresh/blank state. The e2e setup creates channels, users, and browser sessions that persist.
- If the Playwright test does `page.goto('/some-path')`, convert it to `When I open the Xyne-Space at "/some-path"`.

### Rule 8 — Proper Cucumber Feature File Format
- The feature file MUST start with a `Feature:` keyword followed by a descriptive name.
- Each scenario MUST use `Scenario:` or `Scenario Outline:` keyword.
- Steps MUST use `Given`, `When`, `Then`, `And`, or `But` keywords properly.
- The feature file MUST be syntactically valid Gherkin.
- Each step MUST be on its own line with proper indentation.
- Use `Background:` for common setup steps shared across scenarios.
- If the Playwright test has multiple `test()` blocks, create separate `Scenario:` blocks for each.
- Add a blank line between scenarios for readability.
- Tags go on the line BEFORE the Feature or Scenario they apply to.

### Rule 9 — Keyboard Commands & Key Presses
- **NEVER skip or ignore keyboard actions** from the Playwright spec.
- Convert ALL keyboard actions:

| Playwright pattern | Cucumber step pattern |
|---|---|
| `page.keyboard.press('<key>')` | `I press the "<key>" key` |
| `page.keyboard.type('<text>')` | `I type "<text>" using keyboard` |
| `page.locator('<sel>').press('<key>')` | `I press the "<key>" key on the element "<sel>"` |

- The `<key>` value must be copied EXACTLY from the Playwright spec.
- **Step definitions are REQUIRED**: For EVERY keyboard/action step, check QUICK REFERENCE. If not defined, add the step definition.

### Rule 10 — Wait Steps & Timing
- **NEVER skip wait calls** — they exist because the UI needs time.
- Convert waits:

| Playwright pattern | Cucumber step pattern |
|---|---|
| `page.waitForSelector('sel')` | `I wait for "sel" to be visible` |
| `expect(locator).toBeVisible()` | `I wait for "sel" to be visible` |
| `page.waitForURL('**/path')` | `I wait for the URL to contain "/path"` |
| `page.waitForTimeout(N)` | `I wait for N milliseconds` |

### Rule 11 — User Search & Selection Patterns
**When converting tests that involve searching for and selecting users, use the search-first-then-select pattern.**

**Incomplete Spec Detection**: Many Playwright specs skip the search step. You MUST detect these and INJECT the missing search step:

| Incomplete Spec Pattern | Complete Conversion |
|---|---|
| `getByTestId('create-new-dm').click()` then `getByText('UserName').click()` | ADD search step! |

**CORRECT conversion (inject missing search step):**
```gherkin
Given using browser "admin-browser"
When I click on "[data-testid='create-new-dm']"
And I type "user:user2-browser.email" on the element "[data-testid='user-search-input']"
And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"
```

### Rule 12 — Use Existing E2E Resources
**Use Existing E2E Resources — NEVER Create New Prerequisites.**

The e2e setup already creates resources. Your generated tests MUST use these existing resources:

**Browser Sessions:**
| Browser | User |
|---|---|
| `admin-browser` | Admin user |
| `user1-browser` | User 1 |
| `user2-browser` | User 2 |
| `user3-browser` | User 3 |

**Existing Resources (already created by e2e flow):**
| Resource | Stored Path | Created By |
|---|---|---|
| Channel | `user1-channel-1` | user1-browser |
| DM | `user1-user2-dm` | user1-browser |
| Group Chat | `group-chat-1` | user1-browser |

**CRITICAL — When Searching for Users, ALWAYS Select SOMEONE ELSE (Not Yourself):**
- If admin-browser is searching → select `user:user1-browser.name` or `user:user2-browser.name` (NOT `user:admin-browser.name`)

## Step Definition Template

```typescript
When('exact step phrase from feature file', async function (this: CustomWorld, param1: string) {
  if (!this.page) throw new Error('Browser not initialized');
  // Implementation here
});
```

## OUTPUT FORMAT

You MUST output BOTH files with complete content inside fenced code blocks.

**CRITICAL — EVERY feature file MUST start with a browser context step:**
```gherkin
Given using browser "admin-browser"
```

**ABSOLUTELY FORBIDDEN**: Do NOT use `Given a browser "..." with viewport ...` — this creates a NEW unauthenticated browser.

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

## File: {{OUTPUT_FOLDER}}/NN_<file_name>.feature
```gherkin
<full feature file content>
```

## File: {{OUTPUT_FOLDER}}/steps/NN_<file_name>.steps.ts
```typescript
<full steps file content>
```
