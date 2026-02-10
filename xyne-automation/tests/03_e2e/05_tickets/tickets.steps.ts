import { Then, When } from '@cucumber/cucumber';
import { expect } from 'chai';

import { uiLogger } from '@/lib/logger';

import '@/fixtures/cucumber.parameters';
import { CustomWorld, scope } from '@/fixtures/cucumber.world';

When('I click on the first channel in the channel list', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  const channelsSection = this.page.locator('button:has-text("Channels")').first();
  await channelsSection.waitFor({ state: 'visible', timeout: 10000 });

  const accordionItem = channelsSection.locator('..').locator('..');
  const firstChannel = accordionItem.locator('a[href^="/chat/"]').first();
  await firstChannel.waitFor({ state: 'visible', timeout: 5000 });
  await firstChannel.click();

  uiLogger.info('[Tickets] Clicked on the first channel in the channel list');
});

When(
  'I click on the first option in the element {string}',
  async function (this: CustomWorld, selector: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const container = this.page.locator(selector);
    await container.waitFor({ state: 'visible', timeout: 5000 });

    // Click on the first option/item in the container
    const firstOption = container.locator('> *').first();
    await firstOption.click();

    uiLogger.info(`[Tickets] Clicked on the first option in "${selector}"`);
  }
);

When('I click on the send options dropdown', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  const sendButtonArea = this.page
    .locator('[aria-label="Send message"], [aria-label="Create ticket"]')
    .first();
  await sendButtonArea.waitFor({ state: 'visible', timeout: 5000 });

  const parentContainer = sendButtonArea.locator('..');
  const chevronButton = parentContainer
    .locator('button')
    .filter({ has: this.page.locator('svg') })
    .last();

  const dropdownButton = this.page.locator('button:has(svg.lucide-chevron-down)').first();

  try {
    await dropdownButton.waitFor({ state: 'visible', timeout: 3000 });
    await dropdownButton.click();
    uiLogger.info('[Tickets] Clicked on send options dropdown using chevron icon');
  } catch {
    // Fallback: try clicking the chevron button near send
    await chevronButton.click();
    uiLogger.info('[Tickets] Clicked on send options dropdown using sibling button');
  }
});

When(
  'I upload a file {string} to the element {string}',
  async function (this: CustomWorld, filePath: string, selector: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const fileInput = this.page.locator(selector);
    await fileInput.setInputFiles(filePath);

    uiLogger.info(`[Tickets] Uploaded file "${filePath}" to "${selector}"`);
  }
);

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

    if (await attachButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await attachButton.click();
      await this.page.waitForTimeout(500);

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

  if (!messageBubble || !(await messageBubble.isVisible({ timeout: 3000 }).catch(() => false))) {
    // Fallback: get the last message bubble
    messageBubble = this.page.locator('[data-testid^="chat-message-"]').last();
  }

  await messageBubble.waitFor({ state: 'visible', timeout: 10000 });

  // Hover on the message to show action toolbar
  await messageBubble.hover();
  await this.page.waitForTimeout(500); // Wait for hover actions to appear

  uiLogger.info('[Tickets] Hovered on the last sent message');
});

When('I click on Create Ticket from message hover actions', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  // Click the Create Ticket button in the hover toolbar
  const createTicketButton = this.page.locator('[data-testid="hover-action-create-ticket"]');
  await createTicketButton.waitFor({ state: 'visible', timeout: 5000 });
  await createTicketButton.click();

  // Wait for the CreateTicketModal to open
  await this.page.waitForTimeout(1000);

  uiLogger.info('[Tickets] Clicked Create Ticket from message hover actions');
});

When(
  'I hover on message containing {string} and click Create Ticket',
  async function (this: CustomWorld, messageText: string) {
    if (!this.page) throw new Error('Browser not initialized');

    // Find the message bubble containing the specified text
    const messageBubble = this.page
      .locator(`[data-testid^="chat-message-"]:has-text("${messageText}")`)
      .last();

    await messageBubble.waitFor({ state: 'visible', timeout: 10000 });

    // Hover on the message to show action toolbar
    await messageBubble.hover();
    await this.page.waitForTimeout(500); // Wait for hover actions to appear

    // Click the Create Ticket button
    const createTicketButton = this.page.locator('[data-testid="hover-action-create-ticket"]');
    await createTicketButton.waitFor({ state: 'visible', timeout: 5000 });
    await createTicketButton.click();

    // Wait for the CreateTicketModal to open
    await this.page.waitForTimeout(1000);

    uiLogger.info(`[Tickets] Hovered on message "${messageText}" and clicked Create Ticket`);
  }
);

When('I click on Reply in thread from message hover actions', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  // Click the Reply in thread button in the hover toolbar
  const replyButton = this.page.locator('[data-testid="hover-action-reply-in-thread"]');
  await replyButton.waitFor({ state: 'visible', timeout: 5000 });
  await replyButton.click();

  // Wait for the thread panel to load
  await this.page.waitForTimeout(2000);

  uiLogger.info('[Tickets] Clicked Reply in thread from message hover actions');
});

When(
  'I hover on message containing {string} and click Reply in thread',
  async function (this: CustomWorld, messageText: string) {
    if (!this.page) throw new Error('Browser not initialized');

    // Find the message bubble containing the specified text
    const messageBubble = this.page
      .locator(`[data-testid^="chat-message-"]:has-text("${messageText}")`)
      .last();

    await messageBubble.waitFor({ state: 'visible', timeout: 10000 });

    // Hover on the message to show action toolbar
    await messageBubble.hover();
    await this.page.waitForTimeout(500); // Wait for hover actions to appear

    // Click the Reply in thread button
    const replyButton = this.page.locator('[data-testid="hover-action-reply-in-thread"]');
    await replyButton.waitFor({ state: 'visible', timeout: 5000 });
    await replyButton.click();

    // Wait for the thread panel to load
    await this.page.waitForTimeout(2000);

    uiLogger.info(`[Tickets] Hovered on message "${messageText}" and clicked Reply in thread`);
  }
);

When('I click on Create Ticket button in thread panel', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  // Click the Create Ticket button in the thread panel header
  const createTicketButton = this.page.locator('[data-testid="thread-create-ticket-button"]');
  await createTicketButton.waitFor({ state: 'visible', timeout: 60000 });
  await createTicketButton.click();

  // Wait for the CreateTicketModal to open
  await this.page.waitForTimeout(60000);

  uiLogger.info('[Tickets] Clicked Create Ticket button in thread panel');
});

Then('the thread panel should be visible', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  // Check for thread panel - it usually has the Create Ticket button visible
  const threadPanel = this.page.locator('[data-testid="thread-create-ticket-button"]');
  const isVisible = await threadPanel.isVisible({ timeout: 60000 }).catch(() => false);

  if (!isVisible) {
    // Fallback: check for any thread panel indicator
    const threadHeader = this.page.locator('text="Thread"').first();
    await threadHeader.waitFor({ state: 'visible', timeout: 60000 });
  }

  uiLogger.info('[Tickets] Thread panel is visible');
});

Then(
  'the element {string} should contain text {string}',
  async function (this: CustomWorld, selector: string, expectedText: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const element = this.page.locator(selector).first();
    await element.waitFor({ state: 'visible', timeout: 5000 });

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

Then(
  'I should see a success toast with text {string}',
  async function (this: CustomWorld, expectedText: string) {
    if (!this.page) throw new Error('Browser not initialized');

    const toast = this.page.locator(`[data-sonner-toast]:has-text("${expectedText}")`).first();

    try {
      await toast.waitFor({ state: 'visible', timeout: 10000 });
      uiLogger.info(`[Tickets] Success toast with text "${expectedText}" is visible`);
    } catch {
      // Fallback: try looking for any element with the text
      const fallbackToast = this.page.locator(`text="${expectedText}"`).first();
      await fallbackToast.waitFor({ state: 'visible', timeout: 5000 });
      uiLogger.info(`[Tickets] Found toast text "${expectedText}" via fallback selector`);
    }
  }
);

When('I click on the channel Tickets tab', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  uiLogger.info('[Tickets] Clicking on channel Tickets tab');

  // Click on the Tickets tab using the data-testid we added
  const ticketsTab = this.page.locator('[data-testid="channel-tab-tickets"]');

  await ticketsTab.waitFor({ state: 'visible', timeout: 10000 });
  await ticketsTab.click();

  uiLogger.info('[Tickets] Clicked on Tickets tab');
});

When('I click on Create Ticket button in Tickets tab', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  uiLogger.info('[Tickets] Clicking on Create Ticket button in Kanban/Tickets tab view');

  // Click on the Create Ticket button in the KanbanBoardScreen
  const createTicketButton = this.page.locator('[data-testid="kanban-create-ticket-button"]');

  await createTicketButton.waitFor({ state: 'visible', timeout: 10000 });
  await createTicketButton.click();

  uiLogger.info('[Tickets] Clicked on Create Ticket button in Tickets tab');
});

When('I select a workflow if available', async function (this: CustomWorld) {
  if (!this.page) throw new Error('Browser not initialized');

  uiLogger.info('[Tickets] Attempting to select a workflow if available');

  try {
    // Check if workflow selector input exists
    const workflowInput = this.page.locator('[data-testid="ticket-workflow-selector-input"]');
    const inputExists = (await workflowInput.count()) > 0;

    if (!inputExists) {
      uiLogger.info('[Tickets] Workflow selector not found on page, skipping workflow selection');
      return;
    }

    await workflowInput.click({ timeout: 5000 });

    await this.page.waitForTimeout(500);

    // Check if options dropdown appeared and has any options
    const optionsContainer = this.page.locator('[data-testid="ticket-workflow-selector-options"]');
    const optionsExist = (await optionsContainer.count()) > 0;

    if (!optionsExist) {
      uiLogger.info('[Tickets] Workflow options dropdown not found, skipping workflow selection');
      // Click elsewhere to close any potential dropdown
      await this.page.keyboard.press('Escape');
      return;
    }

    // Look for any clickable option in the dropdown
    const options = optionsContainer.locator(
      '[role="option"], [data-value], button, div[class*="option"]'
    );
    const optionCount = await options.count();

    if (optionCount === 0) {
      uiLogger.info(
        '[Tickets] No workflow options available in dropdown, skipping workflow selection'
      );
      await this.page.keyboard.press('Escape');
      return;
    }

    // Click the first available option
    await options.first().click();
    uiLogger.info('[Tickets] Selected the first available workflow option');
  } catch (error) {
    uiLogger.info(
      `[Tickets] Could not select workflow (skipping): ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    // Try to close any open dropdown
    try {
      await this.page.keyboard.press('Escape');
    } catch {
      // Ignore escape key errors
    }
  }
});

When(
  'I click on ticket card with title {string}',
  async function (this: CustomWorld, ticketTitle: string) {
    if (!this.page) throw new Error('Browser not initialized');
    const ticketsTab = this.page.locator('[data-testid="channel-tickets-tab"]');
    if (await ticketsTab.isVisible()) {
      await ticketsTab.click();
      await this.page.waitForTimeout(2000);
    }
    const anyTicketCard = this.page.locator('[data-testid^="ticket-card-"]').first();
    await anyTicketCard.waitFor({ state: 'visible', timeout: 60000 });

    const ticketCardSelector = `[data-testid='ticket-card-title']:has-text('${ticketTitle}')`;
    const ticketCard = this.page.locator(ticketCardSelector);
    await ticketCard.waitFor({ state: 'visible', timeout: 60000 });
    await this.page.waitForTimeout(2000);
    await ticketCard.click();
    uiLogger.info(`[Tickets] Clicked on ticket card with title: "${ticketTitle}"`);
  }
);
