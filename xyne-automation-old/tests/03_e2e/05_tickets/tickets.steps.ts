import { Then, When } from '@cucumber/cucumber';
import { expect } from 'chai';

import { uiLogger } from '@/lib/logger';

import '@/fixtures/cucumber.parameters';
import { CustomWorld, scope } from '@/fixtures/cucumber.world';

When('I attach a test file to the ticket', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  const fileInput = this.page.locator('[data-testid="ticket-attachment-input"]').first();

  if ((await fileInput.count()) > 0) {
    // Use setInputFiles to attach a file to the hidden input
    await fileInput.setInputFiles({
      name: 'test-attachment.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This is a test attachment for ticket automation'),
    });
    uiLogger.info('[Tickets] Attached test file to ticket via hidden input');
  } else {
    // Fallback: try clicking the paperclip button first
    const attachButton = this.page.locator('[data-testid="ticket-attachment-button"]').first();

    if (await attachButton.isVisible().catch(() => false)) {
      await attachButton.click();

      // Now try the generic file input
      const genericFileInput = this.page.locator('input[type="file"]').first();
      if ((await genericFileInput.count()) > 0) {
        await genericFileInput.setInputFiles({
          name: 'test-attachment.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('This is a test attachment for ticket automation'),
        });
        uiLogger.info('[Tickets] Attached test file to ticket');
      }
    } else {
      uiLogger.warn('[Tickets] No attachment button or file input found, skipping attachment');
    }
  }
});

When(
  'I store {string} as {string}',
  async function (this: CustomWorld, value: string, key: string) {
    scope.pathData.set(key, value);
    uiLogger.info(`[Tickets] Stored "${key}" with value: ${value}`);
  }
);

When('I hover on the last sent message', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  const lastSentMessage = scope.pathData.get('lastSentMessage');

  let messageBubble;

  if (lastSentMessage) {
    // Try to find by message content
    messageBubble = this.page
      .locator(`[data-testid^="chat-message-"]:has-text("${lastSentMessage}")`)
      .last();
  }

  if (!messageBubble || !(await messageBubble.isVisible().catch(() => false))) {
    // Fallback: get the last message bubble
    messageBubble = this.page.locator('[data-testid^="chat-message-"]').last();
  }

  await messageBubble.waitFor({ state: 'visible' });

  // Hover on the message to show action toolbar
  await messageBubble.hover();

  uiLogger.info('[Tickets] Hovered on the last sent message');
});

Then(
  'the element {string} should contain text {string}',
  async function (this: CustomWorld, selector: string, expectedText: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const element = this.page.locator(selector).first();
    await element.waitFor({ state: 'visible' });

    // Check if it's an input/textarea element
    const tagName = await element.evaluate((el) => el.tagName.toLowerCase());

    let actualText: string;
    if (tagName === 'input' || tagName === 'textarea') {
      // For input/textarea, get the value
      actualText = await element.inputValue();
    } else {
      // For other elements, get textContent
      actualText = (await element.textContent()) || '';
    }

    expect(actualText).to.include(expectedText);

    uiLogger.info(`[Tickets] Verified element "${selector}" contains text "${expectedText}"`);
  }
);

When(
  'I click on ticket card with title {string}',
  async function (this: CustomWorld, ticketTitle: string) {
    if (!this.page) throw new Error('Browser not initialized');
    const ticketsTab = this.page.locator('[data-testid="channel-tickets-tab"]');
    if (await ticketsTab.isVisible()) {
      await ticketsTab.click();
    }
    const anyTicketCard = this.page.locator('[data-testid^="ticket-card-"]').first();
    await anyTicketCard.waitFor({ state: 'visible' });

    const ticketCardSelector = `[data-testid='ticket-card-title']:has-text('${ticketTitle}')`;
    const ticketCard = this.page.locator(ticketCardSelector);
    await ticketCard.waitFor({ state: 'visible' });
    await ticketCard.click();
    uiLogger.info(`[Tickets] Clicked on ticket card with title: "${ticketTitle}"`);
  }
);
