import { Then, When } from '@cucumber/cucumber';
import { expect } from 'chai';

import { e2eLogger } from '@/lib/logger';

import { CustomWorld } from '@/fixtures/cucumber.world';

Then(
  'I should see atleast {int} participant in the element {string}',
  async function (this: CustomWorld, minCount: number, selector: string) {
    if (!this.page) throw new Error('Browser not initialized');

    e2eLogger.info(`[Call] Verifying at least ${minCount} participant(s) in ${selector}`);

    const element = this.page.locator(selector).first();
    await element.waitFor({ state: 'visible' });

    // Poll until the count reaches the minimum
    let count = 0;
    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const countText = await element.textContent();
      count = parseInt(countText?.match(/\d+/)?.[0] || '0', 10);
      if (count >= minCount) break;
    }

    expect(count).to.be.at.least(minCount);

    e2eLogger.info(`[Call] Verified participant count: ${count} (expected at least ${minCount})`);
  }
);

Then(
  'I should see {string}, {string} in active call in the element {string}',
  async function (this: CustomWorld, user1: string, user2: string, selector: string) {
    if (!this.page) throw new Error('Browser not initialized');

    // Resolve user references
    const resolveUserRef = (ref: string): string => {
      const match = ref.match(/^user:([^.]+)\.(.+)$/);
      if (match) {
        const [, browserSession, field] = match;
        for (const [, userData] of this.userData) {
          if (userData.browserSession === browserSession) {
            return userData[field as keyof typeof userData] as string;
          }
        }
        throw new Error(`No user found logged in browser session "${browserSession}"`);
      }
      return ref;
    };

    const resolvedUser1 = resolveUserRef(user1);
    const resolvedUser2 = resolveUserRef(user2);

    e2eLogger.info(`[Call] Verifying users in active call: ${resolvedUser1}, ${resolvedUser2}`);

    const container = this.page.locator(selector).first();
    await container.waitFor({ state: 'visible' });

    // Find all active call entries within the container
    const activeCallEntries = container.locator('[data-testid="active-call"]');
    const activeCallCount = await activeCallEntries.count();

    let foundMatchingCall = false;

    if (activeCallCount > 0) {
      // Check each active call entry to find one that contains BOTH users
      for (let i = 0; i < activeCallCount; i++) {
        const entryText = await activeCallEntries.nth(i).textContent();
        if (entryText?.includes(resolvedUser1) && entryText?.includes(resolvedUser2)) {
          foundMatchingCall = true;
          e2eLogger.info(`[Call] Found matching active call at index ${i}`);
          break;
        }
      }
    } else {
      // Fallback: if no specific active call markers, check all call entries
      const allEntries = container.locator('[role="button"]');
      const entryCount = await allEntries.count();

      for (let i = 0; i < entryCount; i++) {
        const entryText = await allEntries.nth(i).textContent();
        if (entryText?.includes(resolvedUser1) && entryText?.includes(resolvedUser2)) {
          foundMatchingCall = true;
          e2eLogger.info(`[Call] Found matching call entry at index ${i}`);
          break;
        }
      }
    }

    expect(
      foundMatchingCall,
      `Expected to find an active call with users: ${resolvedUser1}, ${resolvedUser2}`
    ).to.be.true;

    e2eLogger.info('[Call] All users verified in active call');
  }
);

When('I dismiss any open dialog', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  e2eLogger.info('[Call] Checking for and dismissing any open dialogs');

  const dialogSelector = '[role="dialog"][aria-modal="true"]';
  const dialog = this.page.locator(dialogSelector);

  // First, check if dialog already exists
  let dialogCount = await dialog.count();
  let isVisible = false;

  if (dialogCount > 0) {
    isVisible = await dialog
      .first()
      .isVisible()
      .catch(() => false);
  }

  // If no dialog is visible, wait a bit for it to appear (e.g., after page navigation)
  if (!isVisible) {
    e2eLogger.info('[Call] No dialog visible yet, waiting for dialog to appear (with timeout)');
    try {
      await dialog
        .first()
        .waitFor({ state: 'visible', timeout: 3000 })
        .catch(() => {
          e2eLogger.info('[Call] No dialog appeared within timeout, nothing to dismiss');
        });
      dialogCount = await dialog.count();
      isVisible =
        dialogCount > 0 &&
        (await dialog
          .first()
          .isVisible()
          .catch(() => false));
    } catch {
      // Dialog didn't appear, which is fine
      e2eLogger.info('[Call] No dialog appeared, nothing to dismiss');
    }
  }

  if (isVisible && dialogCount > 0) {
    e2eLogger.info('[Call] Found open dialog, attempting to dismiss it');

    // Try to find and click the close button (X button) or decline button
    try {
      // Look for close button in the dialog
      const closeButton = dialog
        .first()
        .locator('button:has(svg.lucide-x), button[aria-label*="close" i]')
        .first();
      const closeButtonCount = await closeButton.count();

      if (closeButtonCount > 0 && (await closeButton.isVisible().catch(() => false))) {
        await closeButton.click();
        e2eLogger.info('[Call] Clicked close button to dismiss dialog');
      } else {
        // Try decline call button as fallback
        const declineButton = dialog.first().locator('button:has(svg.lucide-phone-off)').first();
        const declineButtonCount = await declineButton.count();

        if (declineButtonCount > 0 && (await declineButton.isVisible().catch(() => false))) {
          await declineButton.click();
          e2eLogger.info('[Call] Clicked decline button to dismiss dialog');
        } else {
          // Last resort: press Escape key
          await this.page.keyboard.press('Escape');
          e2eLogger.info('[Call] Pressed Escape key to dismiss dialog');
        }
      }
    } catch (error) {
      // If clicking fails, try Escape key
      e2eLogger.info(`[Call] Clicking close button failed: ${error}, trying Escape key`);
      await this.page.keyboard.press('Escape');
    }

    // Wait for dialog to close with retry logic
    let dialogClosed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await dialog.first().waitFor({ state: 'hidden', timeout: 2000 });
        dialogClosed = true;
        e2eLogger.info('[Call] Dialog successfully dismissed');
        break;
      } catch {
        e2eLogger.info(
          `[Call] Dialog still visible after dismissal attempt ${attempt + 1}, retrying...`
        );
        // Try dismissing again
        if (attempt < 2) {
          await this.page.keyboard.press('Escape');
          await this.page.waitForTimeout(500);
        }
      }
    }

    if (!dialogClosed) {
      e2eLogger.warn('[Call] Dialog may still be visible after all dismissal attempts');
    }

    // Small delay to ensure dialog is fully closed
    await this.page.waitForTimeout(300);
  } else {
    e2eLogger.info('[Call] No dialog found or visible, nothing to dismiss');
  }

  e2eLogger.info('[Call] Dialog dismissal check complete');
});

Then(
  'I should see {string} in the selected users badges',
  async function (this: CustomWorld, userRef: string) {
    if (!this.page) throw new Error('Browser not initialized');

    // Resolve user references
    const resolvedUser = userRef.replace(
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

    e2eLogger.info(`[UI] Verifying "${resolvedUser}" appears in selected users badges`);

    // Wait a bit for the selection to complete
    await this.page.waitForTimeout(500);

    // Look for a badge containing the user's name
    // The badges have a remove button with aria-label="Remove {username}"
    const badgeByAriaLabel = this.page.locator(`button[aria-label="Remove ${resolvedUser}"]`);

    // Also try looking for badges that contain the text directly
    const badgeByText = this.page.locator(
      `[data-testid="invite-to-call-modal"] span:text-is("${resolvedUser}")`
    );

    // Check if either selector finds the badge
    const foundByAriaLabel = (await badgeByAriaLabel.count()) > 0;
    const foundByText = (await badgeByText.count()) > 0;

    const found = foundByAriaLabel || foundByText;

    expect(found, `Expected to find "${resolvedUser}" in selected users badges`).to.be.true;

    e2eLogger.info(`[UI] Verified "${resolvedUser}" is in selected users badges`);
  }
);
