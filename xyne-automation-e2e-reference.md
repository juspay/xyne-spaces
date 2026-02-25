# Xyne Automation E2E Test Reference

## 1. Test Structure Overview
- Tests use Cucumber BDD (`.feature` files) and TypeScript step definitions (`.steps.ts`).
- All tests run with pre-initialized, authenticated browsers:
  - `"admin-browser"`
  - `"user1-browser"`
  - `"user2-browser"`
  - `"user3-browser"`
- Browsers are created and logged in during setup. **Never create new browsers or contexts in your tests.**
- Always use:
  ```gherkin
  Given using browser "admin-browser"
  ```
  or switch context as needed:
  ```gherkin
  Given using browser "user2-browser"
  ```

## 2. Dynamic Data Patterns
### User References
- **Never hardcode user names, emails, or IDs.**
- Use dynamic references:
  - `user:admin-browser.name`
  - `user:admin-browser.email`
  - `user:admin-browser.id`
  - `user:user1-browser.name`, etc.
- Example:
  ```gherkin
  And I type "user:user2-browser.email" on the element "[data-testid='user-search-input']"
  And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"
  ```

### Stored Paths / Resource Aliases
- When a test creates a resource (channel, DM, ticket, etc.), **store the current path**:
  ```gherkin
  And I store the current path as "admin-channel-1"
  ```
- To revisit a resource, use:
  ```gherkin
  When I open the Xyne-Space at "admin-channel-1"
  ```
- **Never hardcode URLs or resource IDs.** Use stored aliases or dynamic user references.

### Scenario Outlines for Multi-User Flows
- Use `Scenario Outline` and `Examples` for repetitive flows:
  ```gherkin
  Scenario Outline: Add users to channel
    Given using browser "user1-browser"
    And I type "<email>" on the element "[data-testid='user-search-input']"
    And I click on text "<name>" in the element "[data-testid='user-search-results']"
    Examples:
      | email                    | name                    |
      | user:user2-browser.email | user:user2-browser.name |
      | user:user3-browser.email | user:user3-browser.name |
  ```

### Hardcoded Values
- **Allowed:** Message content, generic search terms, descriptions, etc.
- **Not Allowed:** User-specific data, resource names/IDs, URLs.

## 3. Selectors and Actions
### Faithful Selector Conversion
- **Never invent or change selectors.**
- Always use selectors as in the Playwright spec:
  - `page.getByTestId('foo')` → `I click on "[data-testid='foo']"`
  - `page.getByText('hello')` → `I click on text "hello"`
  - `page.getByRole('button', { name: 'Cancel' })` → `I click the button with text "Cancel"`

### Keyboard Actions
- **Never skip keyboard actions.**
- Use these step patterns:
  - `I press the "<key>" key`
  - `I type "<text>" using keyboard`
  - `I press the "<key>" key on the element "<selector>"`

### Waits and Timing
- **Never skip waits.**
- Use:
  - `I wait for "<selector>" to be visible`
  - `I wait for "<selector>" to disappear`
  - `I wait for the URL to contain "/path"`
  - `I wait for N milliseconds`
  - `I wait for the page to finish loading`

## 4. Reusable Step Patterns (Quick Reference)
**Always use existing step patterns if available.**
**Do not redefine steps that exist in shared or folder-level step files.**

| Step Pattern Example | Description |
|---------------------|-------------|
| `Given using browser "<browser>"` | Switch to an existing browser session |
| `When I open the Xyne-Space at "<path or alias>"` | Navigate to a stored path or relative URL |
| `And I click on "[data-testid='foo']"` | Click by testid |
| `And I click on text "<text>"` | Click by visible text |
| `And I type "<value>" on the element "<selector>"` | Type into an input |
| `And I press the "<key>" key` | Keyboard press |
| `And I press the "<key>" key on the element "<selector>"` | Keyboard press on element |
| `And I wait for "<selector>" to be visible` | Wait for element |
| `And I wait for "<selector>" to disappear` | Wait for element to disappear |
| `And I store the current path as "<alias>"` | Store current URL for reuse |
| `Then I should see "<text>" in the element "<selector>"` | Assertion |

**See `tests/shared/common.steps.ts`, `browser.steps.ts`, `e2e-common.steps.ts` for full list.**

## 5. Feature File Structure
- **Always start with a browser context:**
  ```gherkin
  Background:
    Given using browser "admin-browser"
  ```
- **Each scenario should be self-contained and reusable.**
- **Use tags for grouping:**
  ```gherkin
  @e2e @feature-name
  Feature: My Feature

    Scenario: Do something
      When I open the Xyne-Space at "/some-path"
      And I click on "[data-testid='some-button']"
  ```

## 6. Best Practices
- **Never create new browsers or contexts.** Always reuse `"admin-browser"`, `"user1-browser"`, etc.
- **Never hardcode user/resource data.** Use dynamic references and stored aliases.
- **Split multi-concern specs into focused scenarios.** Use stored paths to share state.
- **Always check for existing step definitions before creating new ones.**
- **Feature files should run in sequence as per folder numbering.** No need to add numbers; the system handles ordering.
- **Tests must be generic and environment-independent.**

## 7. TypeScript Step Definitions
- **Use `this.page` from `CustomWorld` for all Playwright actions.**
- **Always check for null:**
  ```typescript
  if (!this.page) throw new Error('Browser not initialized');
  ```
- **Never access properties not defined in `CustomWorld` or `Config`.**
- **Do not redefine steps that exist in shared files.**

## 8. Summary Table: Dynamic vs. Hardcoded
| Data Type         | Use Dynamic Reference? | Example                                  |
|-------------------|-----------------------|------------------------------------------|
| User name/email   | Yes                   | `user:user2-browser.email`               |
| Channel name      | Yes                   | `user:user1-browser.id`                  |
| Resource path     | Yes                   | `"admin-channel-1"` (stored alias)       |
| Message content   | No (hardcoded OK)     | `"Hello world!"`                         |
| Generic search    | No (hardcoded OK)     | `"test"`                                 |
| URLs              | Yes (relative or alias)| `"/chat"` or `"admin-channel-1"`         |

## 9. Common Mistakes to Avoid
- ❌ Hardcoding user emails, names, or IDs.
- ❌ Creating new browsers/contexts.
- ❌ Inventing selectors or changing selector types.
- ❌ Skipping keyboard actions or waits.
- ❌ Redefining existing step definitions.
- ❌ Using absolute URLs or environment-specific data.

## 10. References
- **Shared step files:**
  - `tests/shared/common.steps.ts`
  - `tests/shared/browser.steps.ts`
  - `tests/03_e2e/e2e-common.steps.ts`
- **Type definitions:**
  - `tests/fixtures/cucumber.world.ts`
  - `tests/fixtures/config.ts`
- **Existing feature and steps files:**
  - `tests/03_e2e/*/*.feature`
  - `tests/03_e2e/*/steps/*.steps.ts`

**Use this document as the canonical reference for all LLM-based and manual test generation in xyne-automation.**
**Follow all conventions strictly to ensure compatibility and maintainability.**
