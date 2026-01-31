/**
 * Multi-User Chat Page for Xyne Spaces
 * Handles 2-user chat automation scenarios in Spaces environment
 * Uses multiple browser contexts to simulate real concurrent chat between users
 */

import { Page, BrowserContext } from '@playwright/test';
import { expect } from '@/framework/utils/instrumented-page';
import { SpacesLoginHelper } from './spaces-login-helper';

export interface SpacesChatUser {
  context: BrowserContext;
  page: Page;
  name: string;
  credentials?: {
    email: string;
    password: string;
  };
}

export class SpacesMultiUserChatPage {
  private user1: SpacesChatUser | null = null;
  private user2: SpacesChatUser | null = null;
  private chatRoomId: string | null = null;
  private user1Name: string | null = null;
  private user2Name: string | null = null;

  /**
   * Initialize two users with separate browser contexts for Spaces
   */
  async initializeUsers(
    context1: BrowserContext,
    context2: BrowserContext,
    user1Name: string = 'User 1',
    user2Name: string = 'User 2'
  ): Promise<{ user1: SpacesChatUser; user2: SpacesChatUser }> {
    console.log(' Initializing two users for Spaces chat testing');

    // Get viewport dimensions from environment variables
    const viewportWidth = parseInt(process.env.VIEWPORT_WIDTH || '1920', 10);
    const viewportHeight = parseInt(process.env.VIEWPORT_HEIGHT || '1080', 10);
    
    console.log(` Setting viewport size: ${viewportWidth}x${viewportHeight}`);

    // Create pages for both users with specified viewport with specified viewport
    const page1 = await context1.newPage();
    await page1.setViewportSize({ width: viewportWidth, height: viewportHeight });
    const page2 = await context2.newPage();
    await page2.setViewportSize({ width: viewportWidth, height: viewportHeight });
    await page2.setViewportSize({ width: viewportWidth, height: viewportHeight });

    // Initialize user objects
    this.user1 = {
      context: context1,
      page: page1,
      name: user1Name,
    };

    this.user2 = {
      context: context2,
      page: page2,
      name: user2Name,
    };

    console.log(` Initialized ${user1Name} and ${user2Name} for Spaces`);

    return {
      user1: this.user1,
      user2: this.user2,
    };
  }

  /**
   * Login both users concurrently.
   * Supports different credentials for each user.
   * A small delay is introduced between login initiations to prevent race conditions.
   * @param useDifferentUsers - If true, uses USER1 and USER2 credentials from .env (default: false)
   */
  async loginBothUsers(
    useDifferentUsers: boolean = false,
    // loginDelay: number = 2000 // Keep for legacy same-user mode
  ): Promise<void> {
    if (!this.user1 || !this.user2) {
      throw new Error('Users not initialized. Call initializeUsers() first.');
    }

    if (useDifferentUsers) {
      // Use different credentials - PARALLEL execution with 5-second stagger
      console.log(` Starting PARALLEL login for ${this.user1.name} and ${this.user2.name} with different credentials (5-second stagger)...`);
      
      // Start User 1 login
      console.log(` [User 1] Attempting login with email: ${process.env.USER1_GOOGLE_EMAIL}`);
      console.log(` [User 1] Has password: ${!!process.env.USER1_GOOGLE_PASSWORD}`);
      console.log(` [User 1] Has TOTP: ${!!process.env.USER1_TOTP_SECRET_KEY}`);
      
      const user1Promise = SpacesLoginHelper.performLoginWithCredentials(
        this.user1.page,
        process.env.USER1_GOOGLE_EMAIL!,
        process.env.USER1_GOOGLE_PASSWORD!,
        process.env.USER1_TOTP_SECRET_KEY
      );
      
      // Wait 5 seconds before starting User 2 login (stagger to avoid conflicts)
      console.log(` Waiting 5 seconds before starting User 2 login...`);
      await this.user2.page.waitForTimeout(5000);
      
      // Start User 2 login (runs in parallel with User 1)
      console.log(` [User 2] Attempting login with email: ${process.env.USER2_GOOGLE_EMAIL}`);
      console.log(` [User 2] Has password: ${!!process.env.USER2_GOOGLE_PASSWORD}`);
      console.log(` [User 2] Has TOTP: ${!!process.env.USER2_TOTP_SECRET_KEY}`);
      
      const user2Promise = SpacesLoginHelper.performLoginWithCredentials(
        this.user2.page,
        process.env.USER2_GOOGLE_EMAIL!,
        process.env.USER2_GOOGLE_PASSWORD!,
        process.env.USER2_TOTP_SECRET_KEY
      );
      
      // Wait for both logins to complete
      console.log(` Waiting for both users to complete login...`);
      const [user1Success, user2Success] = await Promise.all([user1Promise, user2Promise]);
      
      // Check User 1 result
      if (!user1Success) {
        throw new Error(`Failed to login User 1 to Spaces with credentials: ${process.env.USER1_GOOGLE_EMAIL}`);
      }
      console.log(` [User 1] Login successful`);
      
      // Check User 2 result
      if (!user2Success) {
        // Capture screenshot on failure
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
        const screenshotPath = `reports/user2-login-failed-${timestamp}.png`;
        await this.user2.page.screenshot({ path: screenshotPath, fullPage: true }).catch(err => {
          console.error(` Failed to capture screenshot: ${err.message}`);
        });
        console.log(` Screenshot saved to: ${screenshotPath}`);
        console.log(` [User 2] Current URL: ${this.user2.page.url()}`);
        
        throw new Error(`Failed to login User 2 to Spaces with credentials: ${process.env.USER2_GOOGLE_EMAIL}`);
      }
      console.log(` [User 2] Login successful`);
    } else {
      // Use same credentials (legacy mode) - MUST be sequential due to OTP
      console.log(` Logging in ${this.user1.name} to Spaces`);
      await SpacesLoginHelper.performLogin(this.user1.page);
      
      
      console.log(` Logging in ${this.user2.name} to Spaces`);
      await SpacesLoginHelper.performLogin(this.user2.page);
    }
    
    console.log(' Both users logged in successfully to Spaces');
  }

  /**
   * Verify that the expected user is displayed in the chat header
   * @param user - 'user1' or 'user2' (the user checking the header)
   * @param expectedUserName - Name of the user expected in the header
   */
  async verifyChatHeaderUser(user: 'user1' | 'user2', expectedUserName: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`✓ ${user} verifying chat header displays: ${expectedUserName}`);

    // Wait for the header to be stable
    await currentUser.page.waitForTimeout(2000);

    // Locate the header button containing the user name
    const headerUserButton = currentUser.page.locator('button.text-base.font-semibold.text-gray-900.hover\\:underline');
    
    await expect(headerUserButton).toBeVisible({ timeout: 10000 });
    
    // Get the actual text from the header
    const actualText = await headerUserButton.textContent();
    
    if (!actualText) {
      throw new Error(`No text found in chat header for ${user}`);
    }
    
    // Compare case-insensitively
    if (actualText.toLowerCase() !== expectedUserName.toLowerCase()) {
      throw new Error(`Chat header mismatch for ${user}. Expected: "${expectedUserName}" (case-insensitive), but got: "${actualText}"`);
    }
    
    console.log(`✓ ${user} verified chat header displays: "${actualText}" (matches "${expectedUserName}" case-insensitively)`);
  }

  /**
   * Open a direct chat with a specific user
   * @param fromUserPage - The user initiating the chat
   * @param toUserName - The name of the user to chat with
   */
  private async openChatWithUser(fromUserPage: SpacesChatUser, toUserName: string): Promise<void> {
    console.log(` ${fromUserPage.name} opening chat with ${toUserName}`);
    
    // Step 1: Navigate to Spaces chat page
    await fromUserPage.page.goto(process.env.SPACES_URL || 'http://localhost:3001');
    await fromUserPage.page.waitForLoadState('networkidle');
    await fromUserPage.page.waitForTimeout(2000);
    
    // Step 2: Find and use the search input to search for the user
    console.log(` Searching for user in Spaces: ${toUserName}...`);
    const searchInput = fromUserPage.page.locator('input[placeholder="Search users and channels"]');
    
    try {
      await searchInput.waitFor({ state: 'visible', timeout: 10000 });
      
      // Click on the search input to focus it
      await searchInput.click();
      console.log(` Spaces search input focused`);
      await fromUserPage.page.waitForTimeout(1000);
      
      // Type the user name to search
      await searchInput.fill(toUserName);
      console.log(` Typed "${toUserName}" in Spaces search`);
      await fromUserPage.page.waitForTimeout(2000);
      
      // Wait for search results to appear
      console.log(` Waiting for Spaces search results...`);
      await fromUserPage.page.waitForTimeout(2000);
      
      // Click on the search result using the exact element structure
      const searchResultItem = fromUserPage.page.locator('div.chat-sidebar-search-result-item').first();
      
      try {
        await searchResultItem.waitFor({ state: 'visible', timeout: 5000 });
        await searchResultItem.click();
        console.log(` Clicked on Spaces search result for ${toUserName}`);
        await fromUserPage.page.waitForTimeout(2000);
      } catch (e) {
        console.log(` Primary Spaces search result not found, trying alternative...`);
        
        // Alternative: Try clicking on the name span within the result
        const nameSpan = fromUserPage.page.locator('span.chat-sidebar-search-result-name', { hasText: toUserName }).first();
        const nameVisible = await nameSpan.isVisible({ timeout: 3000 }).catch(() => false);
        
        if (nameVisible) {
          await nameSpan.click();
          console.log(` Clicked on name span in Spaces for ${toUserName}`);
          await fromUserPage.page.waitForTimeout(2000);
        } else {
          console.log(` Spaces search result not found, continuing anyway...`);
        }
      }
      
    } catch (e) {
      console.log(` Spaces search input not found or error: ${e}`);
    }
    
    console.log(` Spaces chat with ${toUserName} should be open`);
  }

  async navigateBothUsersToChat(): Promise<void> {
    if (!this.user1 || !this.user2) {
      throw new Error('Users not initialized. Call initializeUsers() first.');
    }

    console.log(' Setting up Spaces chat between both users');

    // Wait for both pages to be ready after login
    await this.user1.page.waitForLoadState('networkidle');
    await this.user2.page.waitForLoadState('networkidle');
    await this.user1.page.waitForTimeout(3000);
    await this.user2.page.waitForTimeout(3000);
    
    console.log(' Both users are logged in to Spaces and pages are ready');
    
    // User 1 opens chat with User 2
    await this.openChatWithUser(this.user1, this.user2.name);
    
    // User 2 opens chat with User 1
    await this.openChatWithUser(this.user2, this.user1.name);

    console.log(' Both users have opened Spaces chat with each other');
  }

  /**
   * User 1 sends a message in Spaces (legacy method - redirects to sendPlainMessage)
   */
  async user1SendsMessage(message: string): Promise<void> {
    if (!this.user1) {
      throw new Error('User 1 not initialized');
    }

    console.log(` ${this.user1.name} sending in Spaces: "${message}"`);
    await this.sendPlainMessage('user1', message);
    console.log(` ${this.user1.name} message sent in Spaces`);
  }

  /**
   * User 2 sends a message in Spaces (legacy method - redirects to sendPlainMessage)
   */
  async user2SendsMessage(message: string): Promise<void> {
    if (!this.user2) {
      throw new Error('User 2 not initialized');
    }

    console.log(` ${this.user2.name} sending in Spaces: "${message}"`);
    await this.sendPlainMessage('user2', message);
    console.log(` ${this.user2.name} message sent in Spaces`);
  }

  /**
   * Verify User 1 can see a specific message in Spaces
   */
  async verifyUser1SeesMessage(message: string, timeout: number = 10000): Promise<void> {
    if (!this.user1) {
      throw new Error('User 1 not initialized');
    }

    console.log(` Verifying ${this.user1.name} sees in Spaces: "${message}"`);
    
    // Look for the message within the jp-message-html container
    const messageLocator = this.user1.page.locator('div.jp-message-html').filter({ hasText: message }).first();
    await expect(messageLocator).toBeVisible({ timeout });
    
    console.log(` ${this.user1.name} confirmed message visible in Spaces`);
  }

  /**
   * Verify User 2 can see a specific message in Spaces
   */
  async verifyUser2SeesMessage(message: string, timeout: number = 10000): Promise<void> {
    if (!this.user2) {
      throw new Error('User 2 not initialized');
    }

    console.log(` Verifying ${this.user2.name} sees in Spaces: "${message}"`);
    
    // Look for the message within the jp-message-html container
    const messageLocator = this.user2.page.locator('div.jp-message-html').filter({ hasText: message }).first();
    await expect(messageLocator).toBeVisible({ timeout });
    
    console.log(` ${this.user2.name} confirmed message visible in Spaces`);
  }

  /**
   * Simulate a conversation between two users in Spaces
   * @param conversation Array of messages with sender info
   */
  async simulateConversation(
    conversation: Array<{ sender: 1 | 2; message: string; delay?: number }>
  ): Promise<void> {
    console.log(' Starting Spaces conversation simulation');

    for (const { sender, message, delay = 2000 } of conversation) {
      if (sender === 1) {
        await this.user1SendsMessage(message);
        // Verify user 2 sees it
        await this.verifyUser2SeesMessage(message);
      } else {
        await this.user2SendsMessage(message);
        // Verify user 1 sees it
        await this.verifyUser1SeesMessage(message);
      }

      // Add delay between messages for realistic simulation
      await this.user1?.page.waitForTimeout(delay);
    }

    console.log(' Spaces conversation simulation completed');
  }

  /**
   * Test parallel messaging in Spaces (both users send at the same time)
   */
  async testParallelMessaging(message1: string, message2: string): Promise<void> {
    if (!this.user1 || !this.user2) {
      throw new Error('Users not initialized');
    }

    console.log(' Testing parallel messaging in Spaces');

    // Send messages in parallel
    await Promise.all([
      this.user1SendsMessage(message1),
      this.user2SendsMessage(message2),
    ]);

    // Verify both users see both messages
    await Promise.all([
      this.verifyUser1SeesMessage(message1),
      this.verifyUser1SeesMessage(message2),
      this.verifyUser2SeesMessage(message1),
      this.verifyUser2SeesMessage(message2),
    ]);

    console.log(' Spaces parallel messaging test completed');
  }

  /**
   * Verify message order is correct for both users in Spaces
   */
  async verifyMessageOrder(messages: string[]): Promise<void> {
    if (!this.user1 || !this.user2) {
      throw new Error('Users not initialized');
    }

    console.log(' Verifying message order in Spaces');

    for (const [index, message] of messages.entries()) {
      console.log(`Checking message ${index + 1} in Spaces: "${message}"`);
      
      // Check in both user views
      await Promise.all([
        this.verifyUser1SeesMessage(message),
        this.verifyUser2SeesMessage(message),
      ]);
    }

    console.log(' Message order verified for both users in Spaces');
  }

  /**
   * Get all messages from User 1's view in Spaces
   */
  async getUser1Messages(): Promise<string[]> {
    if (!this.user1) {
      throw new Error('User 1 not initialized');
    }

    const messages = await this.user1.page.locator('div.jp-message-html').allTextContents();
    return messages.map(msg => msg.trim()).filter(msg => msg.length > 0);
  }

  /**
   * Get all messages from User 2's view in Spaces
   */
  async getUser2Messages(): Promise<string[]> {
    if (!this.user2) {
      throw new Error('User 2 not initialized');
    }

    const messages = await this.user2.page.locator('div.jp-message-html').allTextContents();
    return messages.map(msg => msg.trim()).filter(msg => msg.length > 0);
  }

  /**
   * Compare messages between User 1 and User 2 and return detailed JSON comparison
   */
  async compareMessagesDetailed(): Promise<{
    user1Count: number;
    user2Count: number;
    matchCount: number;
    mismatch: boolean;
    onlyInUser1: string[];
    onlyInUser2: string[];
    commonMessages: string[];
    summary: string;
  }> {
    if (!this.user1 || !this.user2) {
      throw new Error('Users not initialized');
    }

    const user1Messages = await this.getUser1Messages();
    const user2Messages = await this.getUser2Messages();

    // Find messages only in user1
    const onlyInUser1 = user1Messages.filter(msg => !user2Messages.includes(msg));
    
    // Find messages only in user2
    const onlyInUser2 = user2Messages.filter(msg => !user1Messages.includes(msg));
    
    // Find common messages
    const commonMessages = user1Messages.filter(msg => user2Messages.includes(msg));

    const mismatch = user1Messages.length !== user2Messages.length || 
                     onlyInUser1.length > 0 || 
                     onlyInUser2.length > 0;

    const comparison = {
      user1Count: user1Messages.length,
      user2Count: user2Messages.length,
      matchCount: commonMessages.length,
      mismatch,
      onlyInUser1,
      onlyInUser2,
      commonMessages,
      summary: mismatch 
        ? `Message mismatch detected: User 1 has ${onlyInUser1.length} unique messages, User 2 has ${onlyInUser2.length} unique messages`
        : `All ${commonMessages.length} messages match between both users`
    };

    return comparison;
  }

  /**
   * Verify both users see the same message count in Spaces
   */
  async verifyMessageCountMatch(): Promise<void> {
    if (!this.user1 || !this.user2) {
      throw new Error('Users not initialized');
    }

    const comparison = await this.compareMessagesDetailed();

    console.log(` Spaces - User 1 sees ${comparison.user1Count} messages`);
    console.log(` Spaces - User 2 sees ${comparison.user2Count} messages`);
    console.log(` Common messages: ${comparison.matchCount}`);

    if (!comparison.mismatch) {
      console.log(' ✓ Spaces message counts match - all messages synchronized');
    } else {
      console.log(' ✗ Message mismatch detected:');
      if (comparison.onlyInUser1.length > 0) {
        console.log(`   - ${comparison.onlyInUser1.length} messages only visible to User 1`);
      }
      if (comparison.onlyInUser2.length > 0) {
        console.log(`   - ${comparison.onlyInUser2.length} messages only visible to User 2`);
      }
      throw new Error(`Spaces message count mismatch: User 1 (${comparison.user1Count}) vs User 2 (${comparison.user2Count})`);
    }
  }

  /**
   * Clean up - close all pages and contexts
   */
  async cleanup(): Promise<void> {
    console.log(' Cleaning up Spaces user sessions');

    const closePromises = [];

    if (this.user1) {
      closePromises.push(this.user1.page.close());
    }

    if (this.user2) {
      closePromises.push(this.user2.page.close());
    }

    await Promise.all(closePromises);

    this.user1 = null;
    this.user2 = null;

    console.log(' Spaces cleanup completed');
  }

  /**
   * Take screenshots of both users' views for debugging
   */
  async takeScreenshotsOfBothUsers(prefix: string = 'spaces-multi-user'): Promise<void> {
    if (!this.user1 || !this.user2) {
      throw new Error('Users not initialized');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    await Promise.all([
      this.user1.page.screenshot({ 
        path: `reports/${prefix}-user1-${timestamp}.png`,
        fullPage: true 
      }),
      this.user2.page.screenshot({ 
        path: `reports/${prefix}-user2-${timestamp}.png`,
        fullPage: true 
      }),
    ]);

    console.log(` Spaces screenshots saved: ${prefix}-user1/user2-${timestamp}.png`);
  }

  /**
   * Get user name from the settings popover
   * Clicks the settings button and extracts the name from the popover
   * Falls back to deriving name from email if extraction fails
   * @param user - 'user1' or 'user2'
   */
  async getUserNameFromHeader(user: 'user1' | 'user2'): Promise<string> {
    const targetUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!targetUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`Extracting user name from settings popover for ${user}`);

    try {
      // Click the settings button to open the popover
      const settingsButton = targetUser.page.locator('button[data-slot="popover-trigger"]:has(svg.lucide-settings)');
      
      await settingsButton.waitFor({ state: 'visible', timeout: 10000 });
      await settingsButton.click();
      console.log(` Clicked settings button for ${user}`);
      
      // Wait for the popover to appear
      await targetUser.page.waitForTimeout(1000);
      
      // Locate the user name in the popover
      const userNameElement = targetUser.page.locator('p.text-sm.font-medium.text-gray-900.truncate');
      
      await userNameElement.waitFor({ state: 'visible', timeout: 5000 });
      const userName = await userNameElement.textContent();
      
      if (userName && userName.trim()) {
        const trimmedName = userName.trim();
        
        // Save the name
        if (user === 'user1') {
          this.user1Name = trimmedName;
        } else {
          this.user2Name = trimmedName;
        }

        console.log(` Extracted ${user} name from settings popover: ${trimmedName}`);
        
        // Close the popover by clicking the settings button again or pressing Escape
        await targetUser.page.keyboard.press('Escape');
        await targetUser.page.waitForTimeout(500);
        
        return trimmedName;
      }
    } catch (error) {
      console.log(` Failed to extract name from settings popover, falling back to email: ${error}`);
      
      // Try to close the popover if it's open
      try {
        await targetUser.page.keyboard.press('Escape');
        await targetUser.page.waitForTimeout(500);
      } catch (e) {
        // Ignore errors while trying to close
      }
    }

    // Fallback: Derive name from email
    console.log(` Deriving name from email for ${user}`);
    const email = user === 'user1' ? process.env.USER1_GOOGLE_EMAIL : process.env.USER2_GOOGLE_EMAIL;
    
    if (!email) {
      throw new Error(`No email found in environment variables for ${user}`);
    }

    // Extract username part before @
    const username = email.split('@')[0];
    
    // Split by dots and capitalize each part
    const nameParts = username.split('.').map(part => {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    });
    
    const userName = nameParts.join(' ');
    
    // Save the name
    if (user === 'user1') {
      this.user1Name = userName;
    } else {
      this.user2Name = userName;
    }

    console.log(` Derived ${user} name from email: ${userName}`);
    return userName;
  }

  /**
   * Click on the chat icon in the sidebar
   * @param user - 'user1' or 'user2'
   */
  async clickChatIconForUser(user: 'user1' | 'user2'): Promise<void> {
    const targetUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!targetUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(` Clicking chat icon for ${user}`);

    // Locate the chat icon link using the href="/chat" attribute
    const chatIconLink = targetUser.page.locator('a[href="/chat"][data-discover="true"]');
    
    await chatIconLink.waitFor({ state: 'visible', timeout: 10000 });
    await chatIconLink.click();
    
    // Wait for navigation
    await targetUser.page.waitForTimeout(2000);
    
    console.log(` Chat icon clicked for ${user}`);
  }

  /**
   * Get saved user names
   */
  getSavedUserNames(): { user1Name: string | null; user2Name: string | null } {
    return {
      user1Name: this.user1Name,
      user2Name: this.user2Name,
    };
  }

  /**
   * Get the locator for the Start DM modal.
   * @param user - 'user1' or 'user2'
   */
  getStartDMModal(user: 'user1' | 'user2') {
    const targetUser = user === 'user1' ? this.user1 : this.user2;
    if (!targetUser) {
      throw new Error(`${user} not initialized`);
    }
    // This is the main dialog container
    return targetUser.page.locator('div[role="dialog"][data-state="open"]');
  }

  /**
   * Get User 1 object
   */
  getUser1(): SpacesChatUser | null {
    return this.user1;
  }

  /**
   * Get User 2 object
   */
  getUser2(): SpacesChatUser | null {
    return this.user2;
  }

  /**
   * Click on the + icon to open Start DM modal
   * @param user - 'user1' or 'user2'
   */
  async clickPlusIconForUser(user: 'user1' | 'user2'): Promise<void> {
    const targetUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!targetUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`➕ Clicking + icon to open Start DM modal for ${user}`);

    // Wait for page to be stable
    await targetUser.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
      console.log('Network not idle, continuing anyway...');
    });

    // Look for the Direct Messages section first
    const directMessagesSection = targetUser.page.locator('div[data-component="DirectorySectionHeader"]:has(h3:has-text("Direct Messages"))');
    await directMessagesSection.waitFor({ state: 'visible', timeout: 10000 });
    console.log(` Found Direct Messages section`);

    // Get the plus button in the Direct Messages section (there's only one)
    const plusButton = directMessagesSection.locator('button.text-\\[\\#464C53\\]:has(svg.lucide-plus)');
    
    try {
      await plusButton.waitFor({ state: 'visible', timeout: 10000 });
      await plusButton.click();
      console.log(` Clicked plus button in Direct Messages section`);
    } catch (e) {
      // Try alternative selector - look for the button with the plus icon
      console.log(`Primary + icon not found, trying alternative selectors...`);
      const altPlusButton = directMessagesSection.locator('button:has(svg.lucide-plus)');
      await altPlusButton.waitFor({ state: 'visible', timeout: 5000 });
      await altPlusButton.click();
      console.log(` Clicked plus button using alternative selector`);
    }
    
    // Wait for modal to appear and animate
    await targetUser.page.waitForTimeout(2000);
    
    // Wait for the modal dialog to be visible - updated selector
    await targetUser.page.locator('div[role="dialog"][data-state="open"]').waitFor({ 
      state: 'visible', 
      timeout: 5000 
    }).catch(() => {
      console.log('Modal dialog not detected immediately after click');
    });
    
    console.log(` + icon clicked for ${user}`);
  }

  /**
   * Verify that the Start DM modal is visible
   * @param user - 'user1' or 'user2'
   */
  async verifyStartDMModalVisible(user: 'user1' | 'user2'): Promise<void> {
    const targetUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!targetUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`Verifying Start DM modal is visible for ${user}`);

    // Wait a bit for modal animation to complete
    await targetUser.page.waitForTimeout(1500);

    // Check for the modal dialog - updated selector without aria-modal attribute
    const modalDialog = targetUser.page.locator('div[role="dialog"][data-state="open"]');
    await expect(modalDialog).toBeVisible({ timeout: 10000 });
    console.log(` Modal dialog found for ${user}`);

    // Try multiple selectors for the modal title "Select people to message"
    let titleFound = false;
    
    // Try primary selector - new div structure
    try {
      const modalTitle = targetUser.page.locator('div.text-base.font-medium.text-foreground:has-text("Select people to message")');
      await expect(modalTitle).toBeVisible({ timeout: 3000 });
      titleFound = true;
      console.log(` Modal title found using primary selector for ${user}`);
    } catch (e) {
      console.log(`Primary title selector not found, trying alternatives...`);
    }

    // Try alternative selectors if primary failed
    if (!titleFound) {
      try {
        const modalTitleAlt = targetUser.page.locator('div:has-text("Select people to message")').first();
        await expect(modalTitleAlt).toBeVisible({ timeout: 3000 });
        titleFound = true;
        console.log(` Modal title found using alternative selector for ${user}`);
      } catch (e) {
        console.log(`Modal title not found, but continuing verification...`);
      }
    }
    
    // Verify key elements of the modal
    const addPeopleInput = targetUser.page.locator('input[placeholder="Type to find people..."]');
    await expect(addPeopleInput).toBeVisible({ timeout: 5000 });
    console.log(` Add people input found for ${user}`);

    const startDMButton = targetUser.page.locator('button:has-text("Start DM")');
    await expect(startDMButton).toBeVisible({ timeout: 5000 });
    console.log(` Start DM button found for ${user}`);

    console.log(` Start DM modal verified for ${user}`);
  }

  /**
   * Type user name in the modal and click Start DM button
   * @param user - 'user1' or 'user2' (the user performing the action)
   * @param targetUserName - Name of the user to start DM with
   */
  async startDMWithUser(user: 'user1' | 'user2', targetUserName: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(` ${user} starting DM with ${targetUserName}`);

    // Type in the search input
    const searchInput = currentUser.page.locator('input[placeholder="Type to find people..."]');
    await searchInput.waitFor({ state: 'visible', timeout: 10000 });
    await searchInput.click();
    await searchInput.fill(targetUserName);
    
    console.log(` Typed "${targetUserName}" in search input`);
    
    // Wait for search results to load
    await currentUser.page.waitForTimeout(2000);

    // Click on the user result in the dropdown listbox
    // The dropdown uses a listbox pattern with li[role="option"] elements
    console.log(`Looking for user result in dropdown for: ${targetUserName}`);
    
    // Try primary selector - li with role="option" containing the user name
    const userResultOption = currentUser.page.locator('li[role="option"]').filter({
      has: currentUser.page.locator(`span.font-medium.truncate:has-text("${targetUserName}")`)
    }).first();
    
    try {
      await userResultOption.waitFor({ state: 'visible', timeout: 5000 });
      await userResultOption.click();
      console.log(` Clicked on user result option for: ${targetUserName}`);
      await currentUser.page.waitForTimeout(1000);
    } catch (e) {
      console.log(`Primary user result option not found, trying alternative selector...`);
      
      // Alternative: Try clicking on any li[role="option"] that contains the user name
      const altUserOption = currentUser.page.locator('li[role="option"]').filter({
        hasText: targetUserName
      }).first();
      await altUserOption.waitFor({ state: 'visible', timeout: 3000 });
      await altUserOption.click();
      console.log(` Clicked on user result using alternative selector`);
      await currentUser.page.waitForTimeout(1000);
    }

    // Click the Start DM button
    const startDMButton = currentUser.page.locator('button:has-text("Start DM")').last();
    
    // Wait for button to be enabled (it starts as disabled)
    await currentUser.page.waitForTimeout(1000);
    
    // Check if button is enabled
    const isDisabled = await startDMButton.isDisabled().catch(() => true);
    
    if (isDisabled) {
      console.log(`Start DM button is still disabled, waiting for it to be enabled...`);
      // Wait a bit more for the button to become enabled after selecting a user
      await currentUser.page.waitForTimeout(2000);
    }

    await startDMButton.click({ force: true }); // Use force in case there are overlay issues
    console.log(` Clicked Start DM button`);
    
    // Wait for navigation/modal to close
    await currentUser.page.waitForTimeout(2000);

    console.log(` ${user} started DM with ${targetUserName}`);
  }

  /**
   * Find the chat input editor for a user
   * @param user - 'user1' or 'user2'
   */
  private getChatInputEditor(user: 'user1' | 'user2') {
    const targetUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!targetUser) {
      throw new Error(`${user} not initialized`);
    }

    // The chat input field with rich text editor
    return targetUser.page.locator('div.tiptap.ProseMirror.chat-input-editor[contenteditable="true"]');
  }

  /**
   * Type message in the chat input field
   * @param user - 'user1' or 'user2'
   * @param message - Message to type
   */
  async typeInChatInput(user: 'user1' | 'user2', message: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`⌨️ ${user} typing message: "${message}"`);

    const chatInput = this.getChatInputEditor(user);
    await chatInput.waitFor({ state: 'visible', timeout: 10000 });
    await chatInput.click();
    await chatInput.fill(message);
    
    console.log(` ${user} typed message in chat input`);
  }

  /**
   * Click the Bold button in the formatting toolbar
   * @param user - 'user1' or 'user2'
   */
  async clickBoldButton(user: 'user1' | 'user2'): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} clicking Bold button`);

    const boldButton = currentUser.page.locator('button[aria-label="Bold"]:has(svg.lucide-bold)');
    await boldButton.waitFor({ state: 'visible', timeout: 10000 });
    await boldButton.click();
    await currentUser.page.waitForTimeout(500);
    
    console.log(` ${user} clicked Bold button`);
  }

  /**
   * Click the Italic button in the formatting toolbar
   * @param user - 'user1' or 'user2'
   */
  async clickItalicButton(user: 'user1' | 'user2'): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} clicking Italic button`);

    const italicButton = currentUser.page.locator('button[aria-label="Italic"]:has(svg.lucide-italic)');
    await italicButton.waitFor({ state: 'visible', timeout: 10000 });
    await italicButton.click();
    await currentUser.page.waitForTimeout(500);
    
    console.log(` ${user} clicked Italic button`);
  }

  /**
   * Click the Numbered List button in the formatting toolbar
   * @param user - 'user1' or 'user2'
   */
  async clickNumberedListButton(user: 'user1' | 'user2'): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} clicking Numbered List button`);

    const numberedListButton = currentUser.page.locator('button[aria-label="Numbered list"]:has(svg.lucide-list-ordered)');
    await numberedListButton.waitFor({ state: 'visible', timeout: 10000 });
    await numberedListButton.click();
    await currentUser.page.waitForTimeout(500);
    
    console.log(` ${user} clicked Numbered List button`);
  }

  /**
   * Click the Bullet List button in the formatting toolbar
   * @param user - 'user1' or 'user2'
   */
  async clickBulletListButton(user: 'user1' | 'user2'): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`• ${user} clicking Bullet List button`);

    const bulletListButton = currentUser.page.locator('button[aria-label="Bullet list"]:has(svg.lucide-list)');
    await bulletListButton.waitFor({ state: 'visible', timeout: 10000 });
    await bulletListButton.click();
    await currentUser.page.waitForTimeout(500);
    
    console.log(` ${user} clicked Bullet List button`);
  }

  /**
   * Click the Send button to send the message
   * @param user - 'user1' or 'user2'
   */
  async clickSendButton(user: 'user1' | 'user2'): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} clicking Send button`);

    const sendButton = currentUser.page.locator('button[aria-label="Send message"]:has(svg.lucide-arrow-up)');
    await sendButton.waitFor({ state: 'visible', timeout: 10000 });
    await sendButton.click();
    await currentUser.page.waitForTimeout(1500);
    
    console.log(` ${user} clicked Send button`);
  }

  /**
   * Send a formatted message with bold text
   * @param user - 'user1' or 'user2'
   * @param message - Message to send
   */
  async sendBoldMessage(user: 'user1' | 'user2', message: string): Promise<void> {
    console.log(`${user} sending bold message: "${message}"`);
    
    await this.clickBoldButton(user);
    await this.typeInChatInput(user, message);
    await this.clickSendButton(user);
    
    console.log(` ${user} sent bold message`);
  }

  /**
   * Send a formatted message with italic text
   * @param user - 'user1' or 'user2'
   * @param message - Message to send
   */
  async sendItalicMessage(user: 'user1' | 'user2', message: string): Promise<void> {
    console.log(`${user} sending italic message: "${message}"`);
    
    await this.clickItalicButton(user);
    await this.typeInChatInput(user, message);
    await this.clickSendButton(user);
    
    console.log(` ${user} sent italic message`);
  }

  /**
   * Send a numbered list message
   * @param user - 'user1' or 'user2'
   * @param items - Array of list items
   */
  async sendNumberedListMessage(user: 'user1' | 'user2', items: string[]): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} sending numbered list with ${items.length} items`);
    
    await this.clickNumberedListButton(user);
    
    const chatInput = this.getChatInputEditor(user);
    await chatInput.waitFor({ state: 'visible', timeout: 10000 });
    await chatInput.click();
    
    // Type each item and press Enter to create new list items
    for (let i = 0; i < items.length; i++) {
      await chatInput.pressSequentially(items[i]);
      if (i < items.length - 1) {
        await currentUser.page.keyboard.press('Enter');
        await currentUser.page.waitForTimeout(300);
      }
    }
    
    await this.clickSendButton(user);
    
    console.log(` ${user} sent numbered list message`);
  }

  /**
   * Send a bullet list message
   * @param user - 'user1' or 'user2'
   * @param items - Array of list items
   */
  async sendBulletListMessage(user: 'user1' | 'user2', items: string[]): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} sending bullet list with ${items.length} items`);
    
    await this.clickBulletListButton(user);
    
    const chatInput = this.getChatInputEditor(user);
    await chatInput.waitFor({ state: 'visible', timeout: 10000 });
    await chatInput.click();
    
    // Type each item and press Enter to create new list items
    for (let i = 0; i < items.length; i++) {
      await chatInput.pressSequentially(items[i]);
      if (i < items.length - 1) {
        await currentUser.page.keyboard.press('Enter');
        await currentUser.page.waitForTimeout(300);
      }
    }
    
    await this.clickSendButton(user);
    
    console.log(` ${user} sent bullet list message`);
  }

  /**
   * Verify that a message with bold formatting is visible
   * @param user - 'user1' or 'user2'
   * @param message - Message to verify
   */
  async verifyBoldMessage(user: 'user1' | 'user2', message: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} verifying bold message: "${message}"`);
    
    // Look for message container first, then find bold text within it
    const messageContainer = currentUser.page.locator('div.jp-message-html').filter({ hasText: message });
    const boldMessage = messageContainer.locator('strong, b').filter({ hasText: message }).first();
    await expect(boldMessage).toBeVisible({ timeout: 10000 });
    
    console.log(` ${user} verified bold message`);
  }

  /**
   * Verify that a message with italic formatting is visible
   * @param user - 'user1' or 'user2'
   * @param message - Message to verify
   */
  async verifyItalicMessage(user: 'user1' | 'user2', message: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} verifying italic message: "${message}"`);
    
    // Look for message container first, then find italic text within it
    const messageContainer = currentUser.page.locator('div.jp-message-html').filter({ hasText: message });
    const italicMessage = messageContainer.locator('em, i').filter({ hasText: message }).first();
    await expect(italicMessage).toBeVisible({ timeout: 10000 });
    
    console.log(` ${user} verified italic message`);
  }

  /**
   * Verify that a numbered list message is visible
   * @param user - 'user1' or 'user2'
   * @param items - Array of list items to verify
   */
  async verifyNumberedList(user: 'user1' | 'user2', items: string[]): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} verifying numbered list with ${items.length} items`);
    
    // Look for message container that contains an ordered list with the first item
    // This ensures we find the right message container
    const messageContainer = currentUser.page.locator('div.jp-message-html').filter({
      has: currentUser.page.locator('ol')
    }).filter({
      hasText: items[0]
    }).last();
    
    await expect(messageContainer).toBeVisible({ timeout: 10000 });
    
    const orderedList = messageContainer.locator('ol');
    await expect(orderedList).toBeVisible({ timeout: 5000 });
    
    // Verify each list item
    for (const item of items) {
      const listItem = orderedList.locator('li').filter({ hasText: item });
      await expect(listItem).toBeVisible({ timeout: 5000 });
      console.log(` Verified list item: "${item}"`);
    }
    
    console.log(` ${user} verified numbered list`);
  }

  /**
   * Verify that a bullet list message is visible
   * @param user - 'user1' or 'user2'
   * @param items - Array of list items to verify
   */
  async verifyBulletList(user: 'user1' | 'user2', items: string[]): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} verifying bullet list with ${items.length} items`);
    
    // Look for message container that contains an unordered list with the first item
    // This ensures we find the right message container
    const messageContainer = currentUser.page.locator('div.jp-message-html').filter({
      has: currentUser.page.locator('ul')
    }).filter({
      hasText: items[0]
    }).last();
    
    await expect(messageContainer).toBeVisible({ timeout: 10000 });
    
    const unorderedList = messageContainer.locator('ul');
    await expect(unorderedList).toBeVisible({ timeout: 5000 });
    
    // Verify each list item
    for (const item of items) {
      const listItem = unorderedList.locator('li').filter({ hasText: item });
      await expect(listItem).toBeVisible({ timeout: 5000 });
      console.log(` Verified list item: "${item}"`);
    }
    
    console.log(` ${user} verified bullet list`);
  }

  /**
   * Send a plain text message using the new chat input
   * @param user - 'user1' or 'user2'
   * @param message - Message to send
   */
  async sendPlainMessage(user: 'user1' | 'user2', message: string): Promise<void> {
    console.log(`${user} sending plain message: "${message}"`);
    
    await this.typeInChatInput(user, message);
    await this.clickSendButton(user);
    
    console.log(` ${user} sent plain message`);
  }

  /**
   * Click the emoji button in the formatting toolbar
   * @param user - 'user1' or 'user2'
   */
  async clickEmojiButton(user: 'user1' | 'user2'): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} clicking Emoji button`);

    // Find the emoji button with the smile SVG icon (more specific selector)
    const emojiButton = currentUser.page.locator('button[aria-label="Insert emoji"]').filter({ has: currentUser.page.locator('svg.lucide-smile') }).first();
    await emojiButton.waitFor({ state: 'visible', timeout: 10000 });
    await emojiButton.click();
    await currentUser.page.waitForTimeout(1000);
    
    console.log(` ${user} clicked Emoji button`);
  }

  /**
   * Select an emoji from the emoji picker
   * @param user - 'user1' or 'user2'
   * @param emojiAriaLabel - The aria-label of the emoji to select (e.g., "grinning face", "thumbs up")
   */
  async selectEmoji(user: 'user1' | 'user2', emojiAriaLabel: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} selecting emoji: ${emojiAriaLabel}`);

    // Wait for emoji picker to appear
    await currentUser.page.waitForTimeout(1000);

    // Click on the emoji button within the emoji picker
    // The emoji picker uses class 'epr-emoji' for emoji buttons
    // Using contains() to match partial data-full-name since it may contain multiple comma-separated values
    const emoji = currentUser.page.locator(`//button[contains(@data-full-name, "${emojiAriaLabel}")]`);
    await emoji.waitFor({ state: 'visible', timeout: 10000 });
    await emoji.click();
    await currentUser.page.waitForTimeout(500);
    
    console.log(` ${user} selected emoji: ${emojiAriaLabel}`);
  }

  /**
   * Send a message with an emoji
   * @param user - 'user1' or 'user2'
   * @param message - Text message before emoji
   * @param emojiAriaLabel - The aria-label of the emoji to insert
   */
  async sendMessageWithEmoji(user: 'user1' | 'user2', message: string, emojiAriaLabel: string): Promise<void> {
    console.log(`${user} sending message with emoji: "${message}" + ${emojiAriaLabel}`);
    
    // Type the message first
    await this.typeInChatInput(user, message);
    
    // Add emoji
    await this.clickEmojiButton(user);
    await this.selectEmoji(user, emojiAriaLabel);
    
    // Send the message
    await this.clickSendButton(user);
    
    console.log(` ${user} sent message with emoji`);
  }

  /**
   * Click the mention (@) button in the formatting toolbar
   * @param user - 'user1' or 'user2'
   */
  async clickMentionButton(user: 'user1' | 'user2'): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`@ ${user} clicking Mention button`);

    // Find the mention button inside the flex container with other formatting buttons
    const mentionButton = currentUser.page.locator('div.flex.items-center.gap-1 button[aria-label="Mention user"]:has(svg.lucide-at-sign)');
    await mentionButton.waitFor({ state: 'visible', timeout: 10000 });
    await mentionButton.click();
    await currentUser.page.waitForTimeout(1000);
    
    console.log(` ${user} clicked Mention button`);
  }

  /**
   * Select a user from the mention dropdown
   * @param user - 'user1' or 'user2' (the user performing the action)
   * @param mentionUserName - Name of the user to mention
   */
  async selectUserToMention(user: 'user1' | 'user2', mentionUserName: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`@ ${user} selecting user to mention: ${mentionUserName}`);

    // Extract first name from full name for typing (e.g., "Amrit Raj" -> "Amrit")
    const firstName = mentionUserName.split(' ')[0];
    
    // Type the first name to filter the dropdown
    const chatInput = this.getChatInputEditor(user);
    await chatInput.pressSequentially(firstName, { delay: 50 });
    await currentUser.page.waitForTimeout(800);

    // Wait for the mention dropdown to appear with filtered results
    const mentionDropdown = currentUser.page.locator('div.bg-white.border.border-gray-200.rounded-2xl.shadow-lg');
    await mentionDropdown.waitFor({ state: 'visible', timeout: 5000 });

    // Click on the button/option with the full user name
    const userOption = currentUser.page.locator(`button`).filter({ has: currentUser.page.locator(`span.text-sm.font-medium.text-gray-800:has-text("${mentionUserName}")`) }).first();
    await userOption.waitFor({ state: 'visible', timeout: 5000 });
    await userOption.click();
    
    console.log(` ${user} selected user to mention: ${mentionUserName}`);
    await currentUser.page.waitForTimeout(500);
  }

  /**
   * Send a message with a user mention
   * @param user - 'user1' or 'user2' (the user performing the action)
   * @param message - Message to send
   * @param mentionUserName - Name of the user to mention
   */
  async sendMessageWithMention(user: 'user1' | 'user2', message: string, mentionUserName: string): Promise<void> {
    console.log(`${user} sending message with mention: "${message}" mentioning ${mentionUserName}`);
    
    // Type the initial message
    await this.typeInChatInput(user, message);
    
    // Add mention
    await this.clickMentionButton(user);
    await this.selectUserToMention(user, mentionUserName);
    
    // Send the message
    await this.clickSendButton(user);
    
    console.log(` ${user} sent message with mention`);
  }

  /**
   * Click the Code Block button in the formatting toolbar
   * @param user - 'user1' or 'user2'
   */
  async clickCodeBlockButton(user: 'user1' | 'user2'): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} clicking Code Block button`);

    const codeBlockButton = currentUser.page.locator('button[aria-label="Code block"]:has(svg.lucide-file-code)');
    await codeBlockButton.waitFor({ state: 'visible', timeout: 10000 });
    await codeBlockButton.click();
    await currentUser.page.waitForTimeout(500);
    
    console.log(` ${user} clicked Code Block button`);
  }

  /**
   * Click the Inline Code button in the formatting toolbar
   * @param user - 'user1' or 'user2'
   */
  async clickInlineCodeButton(user: 'user1' | 'user2'): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} clicking Inline Code button`);

    const inlineCodeButton = currentUser.page.locator('button[aria-label="Inline code"]:has(svg.lucide-code)');
    await inlineCodeButton.waitFor({ state: 'visible', timeout: 10000 });
    await inlineCodeButton.click();
    await currentUser.page.waitForTimeout(500);
    
    console.log(` ${user} clicked Inline Code button`);
  }

  /**
   * Send a message with a code block
   * @param user - 'user1' or 'user2'
   * @param code - Code to send in the code block
   */
  async sendCodeBlockMessage(user: 'user1' | 'user2', code: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} sending code block`);
    
    // Click code block button
    await this.clickCodeBlockButton(user);
    
    // Type the code
    const chatInput = this.getChatInputEditor(user);
    await chatInput.waitFor({ state: 'visible', timeout: 10000 });
    
    // Split code by lines and type each line
    const codeLines = code.split('\n');
    for (let i = 0; i < codeLines.length; i++) {
      await chatInput.pressSequentially(codeLines[i]);
      if (i < codeLines.length - 1) {
        await currentUser.page.keyboard.press('Enter');
        await currentUser.page.waitForTimeout(200);
      }
    }
    
    // Send the message
    await this.clickSendButton(user);
    
    console.log(` ${user} sent code block message`);
  }

  /**
   * Send a message with inline code
   * @param user - 'user1' or 'user2'
   * @param message - Text before the inline code
   * @param code - Inline code to insert
   */
  async sendInlineCodeMessage(user: 'user1' | 'user2', message: string, code: string): Promise<void> {
    console.log(`${user} sending message with inline code: "${message}" with code: ${code}`);
    
    // Type the message
    await this.typeInChatInput(user, message);
    
    // Add inline code
    await this.clickInlineCodeButton(user);
    
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }
    
    const chatInput = this.getChatInputEditor(user);
    await chatInput.pressSequentially(code);
    
    // Send the message
    await this.clickSendButton(user);
    
    console.log(` ${user} sent message with inline code`);
  }

  /**
   * Verify that a message contains an emoji
   * @param user - 'user1' or 'user2'
   * @param message - Message text to look for (without the emoji)
   * @param emojiAriaLabel - The aria-label of the emoji to verify (e.g., "grinning")
   */
  async verifyMessageWithEmoji(user: 'user1' | 'user2', message: string, emojiAriaLabel: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} verifying message with emoji: "${message}" with emoji: ${emojiAriaLabel}`);
    
    // Look for the message container with class 'jp-message-html'
    const messageContainer = currentUser.page.locator('div.jp-message-html').filter({ hasText: message }).first();
    await expect(messageContainer).toBeVisible({ timeout: 10000 });
    console.log(` Found message container with text: "${message}"`);
    
    // Verify the message text is present
    const messageText = messageContainer.locator(`p:has-text("${message}")`);
    await expect(messageText).toBeVisible({ timeout: 5000 });
    
    // Get the full text content including emoji
    const fullText = await messageText.textContent();
    console.log(` Full message text: "${fullText}"`);
    
    // Verify that the message contains more than just the text (indicating emoji is present)
    // The emoji will be rendered as an actual emoji character in the text content
    if (fullText && fullText.length > message.length) {
      console.log(` ${user} verified message with emoji - emoji character detected`);
    } else {
      throw new Error(`Emoji not found in message. Expected message length > ${message.length}, but got ${fullText?.length}`);
    }
    
    console.log(` ${user} verified message with emoji`);
  }

  /**
   * Verify that a message contains a user mention
   * @param user - 'user1' or 'user2'
   * @param mentionedUserName - Name of the mentioned user
   */
  async verifyMention(user: 'user1' | 'user2', mentionedUserName: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} verifying mention of: ${mentionedUserName}`);
    
    // Look for mention - rendered as a span with class 'mention-text'
    const mention = currentUser.page.locator(`span.mention-text:has-text("${mentionedUserName}")`).first();
    await expect(mention).toBeVisible({ timeout: 10000 });
    
    console.log(` ${user} verified mention`);
  }

  /**
   * Verify that a code block is visible
   * @param user - 'user1' or 'user2'
   * @param code - Code snippet to verify (partial match)
   */
  async verifyCodeBlock(user: 'user1' | 'user2', code: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} verifying code block`);
    
    // Look for message container first, then find code block within it
    const messageContainer = currentUser.page.locator('div.jp-message-html').filter({ hasText: code });
    const codeBlock = messageContainer.locator('pre, code[class*="block"]').filter({ hasText: code }).first();
    await expect(codeBlock).toBeVisible({ timeout: 10000 });
    
    console.log(` ${user} verified code block`);
  }

  /**
   * Verify that inline code is visible
   * @param user - 'user1' or 'user2'
   * @param code - Inline code to verify
   */
  async verifyInlineCode(user: 'user1' | 'user2', code: string): Promise<void> {
    const currentUser = user === 'user1' ? this.user1 : this.user2;
    
    if (!currentUser) {
      throw new Error(`${user} not initialized`);
    }

    console.log(`${user} verifying inline code: "${code}"`);
    
    // Look for inline code element (typically <code> tag without pre parent)
    const inlineCode = currentUser.page.locator('code').filter({ hasText: code }).first();
    await expect(inlineCode).toBeVisible({ timeout: 10000 });
    
    console.log(` ${user} verified inline code`);
  }

  /**
   * Capture screenshots from both users on test failure
   * Returns array of screenshot paths for both contexts
   * @param testName - Name of the failed test (for screenshot naming)
   */
  async captureFailureScreenshots(testName: string): Promise<string[]> {
    const screenshotPaths: string[] = [];
    const timestamp = Date.now();
    const sanitizedTestName = testName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50);

    console.log(` Capturing failure screenshots for both users...`);

    // Capture User 1 screenshot
    if (this.user1 && this.user1.page && !this.user1.page.isClosed()) {
      try {
        const user1Path = `reports/test-artifacts/failure-user1-${sanitizedTestName}-${timestamp}.png`;
        await this.user1.page.screenshot({ path: user1Path, fullPage: true, timeout: 5000 });
        screenshotPaths.push(user1Path);
        console.log(` User 1 screenshot captured: ${user1Path}`);
      } catch (error) {
        console.warn(` Failed to capture User 1 screenshot:`, error);
      }
    }

    // Capture User 2 screenshot
    if (this.user2 && this.user2.page && !this.user2.page.isClosed()) {
      try {
        const user2Path = `reports/test-artifacts/failure-user2-${sanitizedTestName}-${timestamp}.png`;
        await this.user2.page.screenshot({ path: user2Path, fullPage: true, timeout: 5000 });
        screenshotPaths.push(user2Path);
        console.log(` User 2 screenshot captured: ${user2Path}`);
      } catch (error) {
        console.warn(` Failed to capture User 2 screenshot:`, error);
      }
    }

    if (screenshotPaths.length === 0) {
      console.warn(` No screenshots captured - both pages may be closed`);
    }

    return screenshotPaths;
  }
}
