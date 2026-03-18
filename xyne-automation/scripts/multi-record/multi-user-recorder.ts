import { chromium, BrowserContext, Page, Locator } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

/**
 * Multi-User Playwright Recorder
 *
 * Opens N browser windows simultaneously, all connected to the same app.
 * Records actions from all windows in sequence into a single spec file.
 * Uses Playwright's CDP-based event recording for reliable capture.
 */

const ACTIONS_DIR = path.resolve(__dirname, '../../tests/actions');
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

interface RecordedAction {
  userIndex: number;
  timestamp: number;
  code: string;
}

interface UserConfig {
  isAdmin: boolean;
  authUrl: string;
  landingPage: string;
}

function getUserConfig(userIndex: number): UserConfig {
  const isAdmin = userIndex === 0;
  return {
    isAdmin,
    authUrl: isAdmin ? `${BASE_URL}/auth?isAdmin=true` : `${BASE_URL}/auth`,
    landingPage: isAdmin ? '**/listprojects' : '**/chat',
  };
}

function generateSpecFile(
  testName: string,
  numUsers: number,
  recordedActions: RecordedAction[]
): string {
  let spec = `import { test, expect } from '@playwright/test';\n\n`;
  spec += `test('${testName}', async ({ browser }) => {\n`;

  for (let i = 0; i < numUsers; i++) {
    const userNum = i + 1;
    const userLabel = i === 0 ? 'Admin' : `User ${userNum}`;

    spec += `\n  // ============================================\n`;
    spec += `  // User ${userNum}: ${userLabel}\n`;
    spec += `  // ============================================\n`;
    spec += `  const user${userNum}Context = await browser.newContext({\n`;
    spec += `    viewport: { width: 1280, height: 720 },\n`;
    spec += `  });\n`;
    spec += `  const user${userNum}Page = await user${userNum}Context.newPage();\n\n`;
  }

  spec += `  // ============================================\n`;
  spec += `  // Recorded Multi-User Interactions\n`;
  spec += `  // ============================================\n\n`;

  const sortedActions = [...recordedActions].sort((a, b) => a.timestamp - b.timestamp);

  let lastUser = -1;
  for (const action of sortedActions) {
    const userNum = action.userIndex + 1;
    const userLabel = action.userIndex === 0 ? 'Admin' : `User ${userNum}`;
    if (action.userIndex !== lastUser) {
      spec += `\n  // --- ${userLabel} (user${userNum}Page) ---\n`;
      lastUser = action.userIndex;
    }
    spec += `  ${action.code}\n`;
  }

  spec += `});\n`;

  return spec;
}

/**
 * Inject a recording script into the page via CDP.
 * The script posts messages back to Node via a unique console marker.
 */
const MARKER = '__MULTI_RECORDER__';

function getInjectionScript(userIndex: number): string {
  return `
  (function() {
    if (window.__multiRecorderInjected) return;
    window.__multiRecorderInjected = true;

    var MARKER = '${MARKER}';
    var userIndex = ${userIndex};

    function escapeStr(s) {
      return s.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'").replace(/\\n/g, '\\\\n');
    }

    function getTestId(el) {
      if (!el || !el.closest) return null;
      var c = el.closest('[data-testid]');
      return c ? c.getAttribute('data-testid') : null;
    }

    function getPlaceholder(el) {
      return el && el.getAttribute ? el.getAttribute('placeholder') : null;
    }

    function getRole(el) {
      return el && el.getAttribute ? el.getAttribute('role') : null;
    }

    function getTextContent(el) {
      if (!el || !el.textContent) return '';
      return el.textContent.trim().substring(0, 60);
    }

    function send(code) {
      console.log(MARKER + JSON.stringify({ userIndex: userIndex, code: code }));
    }

    // Click / Assert / Hover (modifier keys change the action)
    // Click        → .click()
    // Shift+Click  → expect(...).toBeVisible()
    // Alt+Click    → .hover()
    // Ctrl+Click   → expect(...).toHaveText(...)
    // Meta+Click   → expect(...).toContainText(...)
    document.addEventListener('click', function(e) {
      var t = e.target;
      if (!t) return;
      var tag = t.tagName ? t.tagName.toLowerCase() : '';

      // Skip garbage clicks on layout elements
      if (['html', 'body', 'main', 'section', 'header', 'footer', 'nav', 'aside'].indexOf(tag) !== -1) return;

      var testId = getTestId(t);
      var text = getTextContent(t);
      var role = getRole(t);

      // Skip clicks with very long text (likely noise from large containers)
      if (text.length > 50) return;

      // Skip getByRole('main', ...) type selectors
      if (role && ['main', 'banner', 'contentinfo', 'navigation', 'complementary'].indexOf(role) !== -1) return;

      // Build the locator string
      var locator = '';
      if (testId) {
        locator = "page.getByTestId('" + testId + "')";
      } else if (role && text) {
        locator = "page.getByRole('" + role + "', { name: '" + escapeStr(text) + "' })";
      } else if (text && ['button', 'a', 'span', 'li', 'div'].indexOf(tag) !== -1) {
        locator = "page.getByText('" + escapeStr(text) + "')";
      }

      if (!locator) return;

      // Shift+Click → Assert visibility
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        send("await expect(" + locator + ").toBeVisible();");
        return;
      }

      // Alt+Click → Hover
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        send("await " + locator + ".hover();");
        return;
      }

      // Ctrl+Click → Assert exact text
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (text) {
          send("await expect(" + locator + ").toHaveText('" + escapeStr(text) + "');");
        } else {
          send("await expect(" + locator + ").toBeVisible();");
        }
        return;
      }

      // Meta+Click (Cmd on Mac) → Assert contains text
      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        if (text) {
          send("await expect(" + locator + ").toContainText('" + escapeStr(text) + "');");
        } else {
          send("await expect(" + locator + ").toBeVisible();");
        }
        return;
      }

      // Shift+Alt+Click → Assert NOT visible (hidden)
      if (e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        send("await expect(" + locator + ").toBeHidden();");
        return;
      }

      // Ctrl+Shift+Click → Assert enabled
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        send("await expect(" + locator + ").toBeEnabled();");
        return;
      }

      // Normal click
      send("await " + locator + ".click();");
    }, true);

    // Input (debounced - fires on blur/change)
    document.addEventListener('change', function(e) {
      var t = e.target;
      if (!t || t.value === undefined) return;
      var val = t.value;
      var testId = getTestId(t);
      var placeholder = getPlaceholder(t);

      if (testId) {
        send("await page.getByTestId('" + testId + "').fill('" + escapeStr(val) + "');");
      } else if (placeholder) {
        send("await page.getByPlaceholder('" + escapeStr(placeholder) + "').fill('" + escapeStr(val) + "');");
      }
    }, true);

    // Also capture input events for contenteditable / live typing
    var inputTimer = null;
    var lastInputTarget = null;
    document.addEventListener('input', function(e) {
      var t = e.target;
      if (!t) return;
      lastInputTarget = t;
      clearTimeout(inputTimer);
      inputTimer = setTimeout(function() {
        var val = t.value !== undefined ? t.value : (t.textContent || '');
        var testId = getTestId(t);
        var placeholder = getPlaceholder(t);
        if (testId) {
          send("await page.getByTestId('" + testId + "').fill('" + escapeStr(val) + "');");
        } else if (placeholder) {
          send("await page.getByPlaceholder('" + escapeStr(placeholder) + "').fill('" + escapeStr(val) + "');");
        }
      }, 800);
    }, true);

    // Keyboard (Enter, Escape, Tab)
    document.addEventListener('keydown', function(e) {
      if (['Enter', 'Escape', 'Tab'].indexOf(e.key) !== -1) {
        // Clear the input debounce if Enter is pressed right after typing
        if (e.key === 'Enter' && inputTimer) {
          clearTimeout(inputTimer);
          inputTimer = null;
          // Flush the input value first
          var t = e.target;
          if (t) {
            var val = t.value !== undefined ? t.value : (t.textContent || '');
            var testId = getTestId(t);
            var placeholder = getPlaceholder(t);
            if (testId && val) {
              send("await page.getByTestId('" + testId + "').fill('" + escapeStr(val) + "');");
            } else if (placeholder && val) {
              send("await page.getByPlaceholder('" + escapeStr(placeholder) + "').fill('" + escapeStr(val) + "');");
            }
          }
        }

        var target = e.target;
        var testId = getTestId(target);
        if (testId) {
          send("await page.getByTestId('" + testId + "').press('" + e.key + "');");
        } else {
          send("await page.keyboard.press('" + e.key + "');");
        }
      }
    }, true);

    // Navigation
    var lastUrl = location.href;
    setInterval(function() {
      if (location.href !== lastUrl) {
        var newUrl = location.href;
        lastUrl = newUrl;
        send("await page.waitForURL('" + escapeStr(newUrl) + "');");
      }
    }, 500);
  })();
  `;
}

async function injectRecorder(page: Page, userIndex: number, recordedActions: RecordedAction[]): Promise<void> {
  const userNum = userIndex + 1;
  const userLabel = userIndex === 0 ? 'Admin' : `User ${userNum}`;

  // Listen for console messages with our marker
  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.startsWith(MARKER)) return;

    try {
      const json = JSON.parse(text.substring(MARKER.length));
      const code = (json.code as string).replace(/\bpage\b/g, `user${userNum}Page`);
      recordedActions.push({
        userIndex,
        timestamp: Date.now(),
        code,
      });
      console.log(`  [${userLabel}] ${code}`);
    } catch {
      // ignore parse errors
    }
  });

  // Inject on current page
  await page.evaluate(getInjectionScript(userIndex));

  // Re-inject after every navigation
  page.on('load', async () => {
    try {
      await page.evaluate(getInjectionScript(userIndex));
    } catch {
      // page may be closed
    }
  });
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  const isSetup = process.argv.includes('--setup');

  console.log('==========================================');
  console.log('  Multi-User Live Recorder');
  console.log('==========================================');
  console.log('');

  const testName = await ask('Enter test name: ');
  if (!testName) {
    console.error('Error: Test name cannot be empty');
    process.exit(1);
  }

  const cleanTestName = testName.replace(/\.spec\.ts$/, '');

  // Check if --users was passed from the shell script
  const usersArgIndex = process.argv.indexOf('--users');
  let numUsers: number;

  if (usersArgIndex !== -1 && process.argv[usersArgIndex + 1]) {
    numUsers = parseInt(process.argv[usersArgIndex + 1], 10);
    if (isNaN(numUsers) || numUsers < 1) {
      console.error('Error: Invalid number of users');
      process.exit(1);
    }
    console.log(`Using ${numUsers} users (from --users flag)`);
  } else {
    const numUsersStr = await ask('How many users? (e.g., 2): ');
    numUsers = parseInt(numUsersStr, 10);
    if (isNaN(numUsers) || numUsers < 1) {
      console.error('Error: Invalid number of users');
      process.exit(1);
    }
  }

  if (!fs.existsSync(ACTIONS_DIR)) {
    fs.mkdirSync(ACTIONS_DIR, { recursive: true });
  }

  const testFile = path.join(ACTIONS_DIR, `${cleanTestName}.spec.ts`);

  if (fs.existsSync(testFile)) {
    const overwrite = await ask('File exists. Overwrite? (y/n): ');
    if (overwrite !== 'y') {
      console.log('Aborted');
      process.exit(0);
    }
  }

  if (isSetup) {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  SETUP MODE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`  Test file will be created at: ${testFile}`);
    console.log(`  Number of users: ${numUsers}`);
    console.log('');
    console.log('  Configuration saved!');
    console.log('  Run without --setup to start recording.');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    rl.close();
    return;
  }

  console.log('');
  console.log(`Opening ${numUsers} browser windows...`);
  console.log('');

  const recordedActions: RecordedAction[] = [];
  const browser = await chromium.launch({ headless: false });

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  for (let i = 0; i < numUsers; i++) {
    const config = getUserConfig(i);
    const userNum = i + 1;
    const userLabel = i === 0 ? 'Admin' : `User ${userNum}`;

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();
    contexts.push(context);
    pages.push(page);

    console.log(`  Window ${userNum}: ${userLabel} → ${config.authUrl}`);
    await page.goto(config.authUrl);
    recordedActions.push({
      userIndex: i,
      timestamp: Date.now(),
      code: `await user${userNum}Page.goto('${config.authUrl}');`,
    });
    console.log(`  [${userLabel}] await user${userNum}Page.goto('${config.authUrl}');`);

    // Wait for page to fully load before injecting
    await page.waitForLoadState('domcontentloaded');

    // Inject the recorder
    await injectRecorder(page, i, recordedActions);
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  All browser windows are open!');
  console.log('');
  console.log('  Interact with ALL browsers now.');
  console.log('  Actions from ALL windows are being recorded.');
  console.log('  You will see each action logged below.');
  console.log('');
  console.log('  🖱️  Recording shortcuts:');
  console.log('  ─────────────────────────────────────');
  console.log('  Click              → .click()');
  console.log('  Shift + Click      → expect().toBeVisible()');
  console.log('  Alt + Click        → .hover()');
  console.log('  Ctrl + Click       → expect().toHaveText()');
  console.log('  Cmd + Click        → expect().toContainText()');
  console.log('  Shift + Alt + Click→ expect().toBeHidden()');
  console.log('  Ctrl + Shift + Click→ expect().toBeEnabled()');
  console.log('  ─────────────────────────────────────');
  console.log('');
  console.log('  When done, press ENTER here to save & close.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('Recording actions:');
  console.log('');

  // Wait for user to finish
  await ask('');

  console.log('');
  console.log(`Recorded ${recordedActions.length} actions total.`);

  const specContent = generateSpecFile(cleanTestName, numUsers, recordedActions);
  fs.writeFileSync(testFile, specContent, 'utf-8');

  console.log(`✓ Test file saved: ${testFile}`);

  for (const context of contexts) {
    await context.close();
  }
  await browser.close();

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  File: ${testFile}`);
  console.log(`  Actions: ${recordedActions.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  rl.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
