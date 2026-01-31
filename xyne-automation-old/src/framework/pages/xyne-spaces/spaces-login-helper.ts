/**
 * Login Helper for Xyne Spaces
 * Handles all login-related operations specifically for Spaces environment
 * Does NOT use LoginHelper to avoid navigation to sbx URLs
 */

import { Page } from '@playwright/test';
import { GoogleOAuthLoginPage } from '@/framework/pages/xyne-spaces/google-oauth-login-page';
import { TOTPGenerator } from '@/framework/utils/totp-generator';

export class SpacesLoginHelper {
  /**
   * Perform standard login to Xyne Spaces
   * Uses default credentials from .env (GOOGLE_EMAIL, GOOGLE_PASSWORD, TOTP_SECRET_KEY)
   */
  static async performLogin(page: Page): Promise<boolean> {
    console.log(' Logging in to Xyne Spaces with default credentials');
    
    // Navigate to Spaces URL first (use dedicated Spaces URL env var)
    const spacesUrl = process.env.XYNE_SPACES_URL || 'https://spaces.xyne.juspay.net';
    console.log(` Navigating to Spaces: ${spacesUrl}`);
    await page.goto(spacesUrl);
    await page.waitForLoadState('networkidle');
    
    // Get credentials
    const email = process.env.GOOGLE_EMAIL || process.env.USER1_GOOGLE_EMAIL;
    const password = process.env.GOOGLE_PASSWORD || process.env.USER1_GOOGLE_PASSWORD;
    const totpSecret = process.env.TOTP_SECRET_KEY || process.env.USER1_TOTP_SECRET_KEY;
    
    if (!email || !password) {
      console.error(' Missing credentials');
      return false;
    }
    
    // Perform login without navigating
    const loginSuccess = await this.performSpacesLoginFlow(page, email, password, totpSecret);
    
    if (loginSuccess) {
      console.log(' Successfully logged in to Xyne Spaces');
      // Verify we're on Spaces
      await page.waitForURL(/spaces\.xyne\.juspay\.net/, { timeout: 10000 }).catch(() => {
        console.warn(' Not on Spaces URL but login succeeded');
      });
    } else {
      console.error(' Failed to login to Xyne Spaces');
    }
    
    return loginSuccess;
  }

  /**
   * Perform login to Xyne Spaces with custom credentials
   * Useful for multi-user testing with different accounts
   */
  static async performLoginWithCredentials(
    page: Page,
    email: string,
    password: string,
    totpSecret?: string
  ): Promise<boolean> {
    console.log(` Logging in to Xyne Spaces with custom credentials: ${email}`);
    
    // Navigate to Spaces URL first (use dedicated Spaces URL env var)
    const spacesUrl = process.env.XYNE_SPACES_URL || 'https://spaces.xyne.juspay.net';
    console.log(` Navigating to Spaces: ${spacesUrl}`);
    await page.goto(spacesUrl);
    await page.waitForLoadState('networkidle');
    
    // Perform login without navigating
    const loginSuccess = await this.performSpacesLoginFlow(page, email, password, totpSecret);
    
    if (loginSuccess) {
      console.log(` Successfully logged in to Xyne Spaces as ${email}`);
      // Verify we're on Spaces
      await page.waitForURL(/spaces\.xyne\.juspay\.net/, { timeout: 10000 }).catch(() => {
        console.warn(' Not on Spaces URL but login succeeded');
      });
    } else {
      console.error(` Failed to login to Xyne Spaces as ${email}`);
    }
    
    return loginSuccess;
  }

  /**
   * Internal method: Perform Google OAuth login flow without navigation
   * Uses the existing GoogleOAuthLoginPage but clicks the button first
   */
  private static async performSpacesLoginFlow(
    page: Page,
    email: string,
    password: string,
    totpSecret?: string
  ): Promise<boolean> {
    try {
      console.log(`🔑 Starting Google OAuth flow for: ${email}`);
      console.log(` Current URL: ${page.url()}`);
      
      // Step 1: Click "Sign in with Google" button (Spaces specific)
      console.log(' Looking for "Sign in with Google" button...');
      const googleLoginButton = page.getByRole('button', { name: /sign in with google/i });
      await googleLoginButton.waitFor({ state: 'visible', timeout: 10000 });
      await googleLoginButton.click();
      console.log(' Clicked "Sign in with Google" button');
      
      // Wait for Google OAuth page to load
      await page.waitForTimeout(3000);
      console.log(` After button click URL: ${page.url()}`);
      
      // Step 2: Use the existing GoogleOAuthLoginPage methods by temporarily setting env vars
      const originalEmail = process.env.GOOGLE_EMAIL;
      const originalPassword = process.env.GOOGLE_PASSWORD;
      const originalTotpSecret = process.env.TOTP_SECRET_KEY;
      
      try {
        // Temporarily set credentials
        process.env.GOOGLE_EMAIL = email;
        process.env.GOOGLE_PASSWORD = password;
        if (totpSecret) {
          process.env.TOTP_SECRET_KEY = totpSecret;
        }
        
        // Create GoogleOAuthLoginPage instance
        const oauthPage = new GoogleOAuthLoginPage(page);
        
        // Manually call each step (skip initiateGoogleLogin since we already clicked the button)
        await (oauthPage as any).handleGoogleEmailStep();
        await (oauthPage as any).handleGooglePasswordStep();
        await (oauthPage as any).handle2FASelection();
        await (oauthPage as any).handleTOTPStep();
        await (oauthPage as any).handleFinalConsent();
        console.log(' Final consent completed');
        
        // Verify login success
        console.log(' Step 6: Verifying login success...');
        const loginSuccess = await (oauthPage as any).verifyLoginSuccess();
        
        if (loginSuccess) {
          console.log(' Google OAuth login flow completed successfully');
          return true;
        } else {
          console.error(' Login verification failed');
          return false;
        }
        
      } finally {
        // Restore original environment variables
        if (originalEmail) process.env.GOOGLE_EMAIL = originalEmail;
        if (originalPassword) process.env.GOOGLE_PASSWORD = originalPassword;
        if (originalTotpSecret) process.env.TOTP_SECRET_KEY = originalTotpSecret;
      }
      
    } catch (error) {
      console.error(` Spaces login flow failed: ${error}`);
      // Take screenshot for debugging
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await page.screenshot({ path: `reports/spaces-login-error-${timestamp}.png`, fullPage: true });
        console.log(` Screenshot saved: reports/spaces-login-error-${timestamp}.png`);
      } catch (screenshotError) {
        console.error(` Failed to take screenshot: ${screenshotError}`);
      }
      return false;
    }
  }

  /**
   * Verify user is logged in to Spaces
   * Checks URL and presence of user avatar
   */
  static async verifyLoggedIn(page: Page): Promise<boolean> {
    console.log(' Verifying user is logged in to Xyne Spaces');
    
    try {
      // Check URL
      const url = page.url();
      if (!url.includes('spaces.xyne.juspay.net')) {
        console.error(' Not on Spaces URL');
        return false;
      }
      
      // Check for user avatar (indicates logged in)
      const userAvatar = page.locator('[data-avatar="true"], .user-avatar').first();
      const avatarVisible = await userAvatar.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (avatarVisible) {
        console.log(' User is logged in to Xyne Spaces');
        return true;
      } else {
        console.error(' User avatar not found - may not be logged in');
        return false;
      }
    } catch (error) {
      console.error(` Error verifying login: ${error}`);
      return false;
    }
  }

  /**
   * Logout from Xyne Spaces
   */
  static async logout(page: Page): Promise<void> {
    console.log(' Logging out from Xyne Spaces');
    
    try {
      // Click user avatar/menu
      const userAvatar = page.locator('[data-avatar="true"], .user-avatar').first();
      await userAvatar.click();
      await page.waitForTimeout(1000);
      
      // Click logout button
      const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign out")').first();
      await logoutButton.click();
      await page.waitForTimeout(2000);
      
      console.log(' Logged out from Xyne Spaces');
    } catch (error) {
      console.error(` Logout failed: ${error}`);
    }
  }

  /**
   * Get current logged-in user's name from Spaces
   */
  static async getCurrentUserName(page: Page): Promise<string | null> {
    console.log(' Getting current user name from Xyne Spaces');
    
    try {
      // Try to find user name in various places
      const userNameSelectors = [
        '[data-user-name]',
        '.user-name',
        '[data-avatar="true"] + span',
        '.user-profile-name'
      ];
      
      for (const selector of userNameSelectors) {
        const userName = await page.locator(selector).first().textContent().catch(() => null);
        if (userName && userName.trim().length > 0) {
          console.log(` Current user: ${userName}`);
          return userName.trim();
        }
      }
      
      console.warn(' Could not find user name');
      return null;
    } catch (error) {
      console.error(` Error getting user name: ${error}`);
      return null;
    }
  }

  /**
   * Wait for Spaces page to be fully loaded after login
   */
  static async waitForSpacesReady(page: Page, timeout: number = 30000): Promise<void> {
    console.log(' Waiting for Xyne Spaces to be ready...');
    
    try {
      await page.waitForURL(/spaces\.xyne\.juspay\.net/, { timeout });
      await page.waitForLoadState('networkidle', { timeout });
      
      // Wait for main content to be visible
      const mainContent = page.locator('main, [role="main"], .main-content').first();
      await mainContent.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
        console.warn(' Main content not found, but continuing...');
      });
      
      console.log(' Xyne Spaces is ready');
    } catch (error) {
      console.error(` Timeout waiting for Spaces to be ready: ${error}`);
    }
  }

  /**
   * Perform login with retry logic for Spaces
   * Useful when network is unstable
   */
  static async performLoginWithRetry(
    page: Page,
    maxRetries: number = 3
  ): Promise<boolean> {
    console.log(` Attempting login to Xyne Spaces with retry (max ${maxRetries} attempts)`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(` Login attempt ${attempt} of ${maxRetries}`);
      
      const success = await this.performLogin(page);
      
      if (success) {
        console.log(` Login successful on attempt ${attempt}`);
        return true;
      }
      
      if (attempt < maxRetries) {
        console.warn(` Login attempt ${attempt} failed, retrying...`);
        await page.waitForTimeout(5000); // Wait 5 seconds before retry
      }
    }
    
    console.error(` All ${maxRetries} login attempts to Xyne Spaces failed`);
    return false;
  }

  /**
   * Quick health check - verify Spaces is accessible
   */
  static async isSpacesAccessible(page: Page): Promise<boolean> {
    console.log(' Checking if Xyne Spaces is accessible');
    
    try {
      const spacesUrl = process.env.XYNE_SPACES_URL || 'https://spaces.xyne.juspay.net';
      const response = await page.goto(spacesUrl);
      
      if (response && response.ok()) {
        console.log(' Xyne Spaces is accessible');
        return true;
      } else {
        console.error(` Xyne Spaces returned status: ${response?.status()}`);
        return false;
      }
    } catch (error) {
      console.error(` Xyne Spaces is not accessible: ${error}`);
      return false;
    }
  }
}