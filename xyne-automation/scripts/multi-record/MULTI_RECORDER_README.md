# Multi-User Playwright Recorder — Reference Guide

## What Is This?

A custom recorder that opens **multiple browser windows** simultaneously, captures all user interactions across all windows in real-time, and generates a single Playwright `.spec.ts` test file.

Unlike Playwright's built-in `codegen` (which only supports one browser), this supports **N concurrent users** for testing multi-user flows like messaging, collaboration, etc.

---

## Quick Start

```bash
cd xyne-automation

# Record a multi-user test
npm run record-multi-user

# Record with a specific number of users
npm run record-multi-user -- --users 3
```

You'll be prompted for:

1. **Test name** → becomes the filename (`tests/actions/<name>.spec.ts`)
2. **Number of users** (if not passed via `--users`)

---

## Recording Shortcuts

While interacting with the browser windows, use modifier keys to record different actions:

| Action                   | What Gets Recorded                           | Use Case                    |
| ------------------------ | -------------------------------------------- | --------------------------- |
| **Click**                | `await locator.click()`                      | Normal button/element click |
| **Shift + Click**        | `await expect(locator).toBeVisible()`        | Assert element is visible   |
| **Alt + Click**          | `await locator.hover()`                      | Hover over element          |
| **Ctrl + Click**         | `await expect(locator).toHaveText('...')`    | Assert exact text match     |
| **Cmd + Click**          | `await expect(locator).toContainText('...')` | Assert text contains        |
| **Shift + Alt + Click**  | `await expect(locator).toBeHidden()`         | Assert element is hidden    |
| **Ctrl + Shift + Click** | `await expect(locator).toBeEnabled()`        | Assert element is enabled   |

> **Note:** Modifier-key clicks prevent the actual click from happening in the app — they only record the assertion/hover.

### Input Recording

| Action            | What Gets Recorded                                           |
| ----------------- | ------------------------------------------------------------ |
| Type in an input  | `await locator.fill('typed value')` (debounced 800ms)        |
| Press **Enter**   | `await locator.press('Enter')` (flushes pending input first) |
| Press **Escape**  | `await locator.press('Escape')`                              |
| Press **Tab**     | `await locator.press('Tab')`                                 |
| URL changes (SPA) | `await page.waitForURL('...')` (polled every 500ms)          |

---

## Locator Priority

The recorder picks locators in this order:

1. **`data-testid`** → `page.getByTestId('my-button')` _(best — most stable)_
2. **`role` + text** → `page.getByRole('button', { name: 'Submit' })`
3. **Text content** → `page.getByText('Submit')` _(only for button, a, span, li, div)_
4. **`placeholder`** → `page.getByPlaceholder('Search...')` _(for inputs)_

> **Tip:** Add `data-testid` attributes to your components for the most reliable test selectors.

---

## How It Works

### Architecture

```
┌────────────────────────────────────────────────┐
│               Node.js Process                   │
│            (multi-user-recorder.ts)             │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ Window 1  │  │ Window 2  │  │ Window 3  │    │
│  │  Admin    │  │  User 2   │  │  User 3   │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
│       │              │              │            │
│       ▼              ▼              ▼            │
│  ┌────────────────────────────────────────┐     │
│  │   Injected JavaScript per window       │     │
│  │   • click / input / keydown listeners  │     │
│  │   • modifier key detection             │     │
│  │   • locator builder                    │     │
│  │   • console.log(MARKER + JSON)         │     │
│  └──────────────────┬─────────────────────┘     │
│                     │                            │
│                     ▼                            │
│  ┌────────────────────────────────────────┐     │
│  │   page.on('console') in Node.js        │     │
│  │   • Parses MARKER + JSON               │     │
│  │   • Replaces "page" → "user1Page"      │     │
│  │   • Stores in recordedActions[]         │     │
│  └──────────────────┬─────────────────────┘     │
│                     │                            │
│                     ▼                            │
│  ┌────────────────────────────────────────┐     │
│  │   generateSpecFile()                   │     │
│  │   • Sorts all actions by timestamp     │     │
│  │   • Groups consecutive user actions    │     │
│  │   • Writes tests/actions/<name>.spec.ts│     │
│  └────────────────────────────────────────┘     │
└────────────────────────────────────────────────┘
```

### Step-by-Step Flow

1. **Launch** — Opens one Chromium instance with N isolated browser contexts (separate cookies/storage)
2. **Navigate** — Admin goes to `/auth?isAdmin=true`, other users go to `/auth`
3. **Inject** — A JavaScript recording script is injected into each page
4. **Record** — DOM event listeners capture clicks, inputs, keyboard, and navigation
5. **Bridge** — Events are sent from browser → Node.js via `console.log()` with a special marker
6. **Re-inject** — On page navigation, the script is automatically re-injected
7. **Save** — On ENTER, all actions are sorted by timestamp and written to a `.spec.ts` file

### Communication Bridge

The injected browser JS cannot call Node.js directly. Instead:

```
Browser JS:  console.log('__MULTI_RECORDER__' + JSON.stringify({...}))
     ↓
Node.js:     page.on('console', msg => { /* parse MARKER + JSON */ })
```

---

## Browser Configuration

### Available Browsers

The recorder detects available browser configs by scanning:

- Setup feature files (`*setup*.feature`) — Examples tables
- All feature files — `Given using browser "..."` / `Given a browser "..."` steps
- `tests/shared/browser.steps.ts`

Only `admin-browser` and `userN-browser` patterns are included (e.g., `ui-browser` is excluded).

### Adding More Browsers

If you need more than the currently configured browsers:

1. Add a new row in the setup feature's Examples table:

   **`tests/03_e2e/04_messages/01_setup.feature`**

   ```gherkin
   Examples:
     | user  | browser        | user_context | landing_page |
     | user2 | user2-browser  | user2        | /chat        |
     | user3 | user3-browser  | user3        | /chat        |
     | user4 | user4-browser  | user4        | /chat        |  ← add this
   ```

2. This uses the existing step:

   ```gherkin
   Given a browser "user4-browser" with viewport 1280x720
   ```

3. Ensure the user credentials exist in your test environment

---

## Output Format

The recorder generates a file like:

```typescript
import { test, expect } from '@playwright/test';

test('my-test', async ({ browser }) => {
  // ============================================
  // User 1: Admin
  // ============================================
  const user1Context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const user1Page = await user1Context.newPage();

  // ============================================
  // User 2: User 2
  // ============================================
  const user2Context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const user2Page = await user2Context.newPage();

  // ============================================
  // Recorded Multi-User Interactions
  // ============================================

  // --- Admin (user1Page) ---
  await user1Page.goto('http://localhost:5173/auth?isAdmin=true');
  await user1Page.waitForURL('http://localhost:5173/chat/dir');
  await user1Page.getByTestId('create-new-dm').click();

  // --- User 2 (user2Page) ---
  await user2Page.goto('http://localhost:5173/auth');
  await user2Page.getByTestId('message-input').fill('hello');
  await user2Page.getByTestId('message-input').press('Enter');

  // --- Admin (user1Page) ---
  await expect(user1Page.getByTestId('message-bubble')).toBeVisible();
});
```

This file is then converted to Cucumber feature + steps using:

```bash
npm run codegen -- convert:skip-all tests/actions/my-test.spec.ts
```

---

## Filtering & Noise Reduction

The recorder automatically filters out noise:

| Filter                                                | Why                                      |
| ----------------------------------------------------- | ---------------------------------------- |
| Layout tags (`html`, `body`, `main`, `section`, etc.) | Not interactive elements                 |
| Layout roles (`main`, `banner`, `navigation`, etc.)   | Would produce useless selectors          |
| Text longer than 50 chars                             | Likely a container div, not a button     |
| Input debounce (800ms)                                | Records final value, not every keystroke |

---

## Pipeline: Record → Convert → Test

```
npm run record-multi-user          ← Step 1: Record interactions
        │
        ▼
tests/actions/my-test.spec.ts   (Playwright format)
        │
        ▼
npm run codegen -- convert:skip-all tests/actions/my-test.spec.ts   ← Step 2: Convert
        │
        ▼
tests/03_e2e/<folder>/my-test.feature     (Gherkin)
tests/03_e2e/<folder>/steps/my-test.steps.ts  (Step definitions)
        │
        ▼
npx cucumber-js --tags "@setup or @my-test" --profile e2e   ← Step 3: Run
```

---

## Troubleshooting

### Actions not being recorded

- Check the terminal — every action is logged in real-time
- Make sure you're clicking on interactive elements (buttons, links, inputs)
- Elements without `data-testid`, `role`, or visible text won't be captured
- The recorder re-injects on navigation, but iframe content is not captured

### Modifier-key clicks doing the normal action

- `e.preventDefault()` and `e.stopPropagation()` should block the real click
- Some framework-level event handlers might still fire
- If so, the assertion is still recorded — just ignore the UI side-effect

### URL changes not captured

- The recorder polls every 500ms — very fast navigations might be missed
- SPA hash changes are captured
- Full page reloads trigger re-injection automatically

### Too many duplicate `fill()` actions

- The 800ms debounce reduces noise but typing slowly may produce multiple fills
- The codegen conversion LLM will clean these up during the convert step

### Browser limit warning

- The shell script warns if you request more users than configured browsers
- Add more browsers via the setup feature (see "Adding More Browsers" above)

---

## Environment Variables

| Variable   | Default                 | Description                     |
| ---------- | ----------------------- | ------------------------------- |
| `BASE_URL` | `http://localhost:5173` | App URL for all browser windows |

---

## Related Commands

```bash
# Record multi-user test
npm run record-multi-user
npm run record-multi-user -- --users 3
npm run record-multi-user:setup

# Convert recorded spec to Cucumber
npm run codegen -- convert tests/actions/my-test.spec.ts
npm run codegen -- convert:skip-all tests/actions/my-test.spec.ts

# Run converted tests
npx cucumber-js --tags "@setup or @my-test" --profile e2e

# Cleanup generated files
npm run codegen-cleanup

# Full setup
npm run setup
```
