/**
 * Google OAuth + TOTP Login Page
 * Extended LoginPage with complete Google OAuth and TOTP authentication flow
 * TypeScript equivalent of Python's SigninStaging class
 */

import { Page } from '@playwright/test';
import { LoginPage } from './login-page';
import { TOTPGenerator } from '../../utils/totp-generator';

export class GoogleOAuthLoginPage extends LoginPage {
  private totpGenerator: TOTPGenerator | null = null;

  // Google OAuth selectors (based on your Python implementation)
  private googleSelectors = {
    // Email step
    emailField: '#identifierId, [aria-label="Email or phone"]',
    emailNextButton: '#identifierNext, [data-testid="next-button"]',
    
    // Password step
    passwordField: 'input[type="password"], [aria-label="Enter your password"]',
    passwordNextButton: '#passwordNext, [data-testid="password-next"]',
    
    // 2FA options
    tryAnotherWayButton: 'text=Try another way',
    authenticatorOption: 'text=Get a verification code from the Google Authenticator app, text=Google Authenticator',
    
    // TOTP step
    otpField: '[aria-label="Enter code"], input[name="totpPin"], input[type="tel"], #totpPin',
    otpNextButton: 'text=Next',
    
    // Final consent/continue
    finalContinueButton: '[data-testid="continue-button"], button:has-text("Continue")',
    allowButton: 'text=Allow',
    
    // Error elements
    errorMessage: '[role="alert"], .error-message, [data-testid="error"]'
  };

  constructor(page: Page) {
    super(page);
    this.initializeTOTPGenerator();
  }

  /**
   * Initialize TOTP generator from environment variables
   */
  private initializeTOTPGenerator(): void {
    try {
      this.totpGenerator = TOTPGenerator.fromEnvironment('TOTP_SECRET_KEY');
      console.log('TOTP generator initialized successfully');
    } catch (error) {
      console.warn('WARNING: TOTP generator not initialized:', error);
    }
  }

  /**
   * Get credentials from environment variables
   */
  private getCredentials() {
    const email = process.env.GOOGLE_EMAIL;
    const password = process.env.GOOGLE_PASSWORD;
    
    if (!email || !password) {
      throw new Error('Google credentials not found in environment variables. Please set GOOGLE_EMAIL and GOOGLE_PASSWORD.');
    }
    
    return { email, password };
  }

  /**
   * Perform complete Google OAuth + TOTP login flow
   * Main method that orchestrates the entire login process
   */
  async performCompleteLogin(): Promise<boolean> {
    console.log('Starting complete Google OAuth + TOTP login flow');
    
    try {
      // Step 1: Navigate to login page and click Google login
      await this.initiateGoogleLogin();
      
      // Step 2: Handle Google email input
      await this.handleGoogleEmailStep();
      
      // Step 3: Handle Google password input
      await this.handleGooglePasswordStep();
      
      // Step 4: Handle 2FA selection (if needed)
      await this.handle2FASelection();
      
      // Step 5: Handle TOTP code input
      await this.handleTOTPStep();
      
      // Step 6: Handle final consent/continue
      await this.handleFinalConsent();
      
      // Step 7: Verify successful login
      const loginSuccess = await this.verifyLoginSuccess();
      
      if (loginSuccess) {
        console.log('Complete login flow successful');
        return true;
      } else {
        console.error('ERROR: Login verification failed');
        return false;
      }
      
    } catch (error) {
      console.error('ERROR: Login flow failed:', error);
      await this.takeScreenshot('login_error.png');
      return false;
    }
  }

  /**
   * Step 1: Navigate to login page and initiate Google OAuth
   */
  private async initiateGoogleLogin(): Promise<void> {
    console.log('Step 1: Initiating Google login');
    
    // Navigate to login page
    const loginUrl = this.getLoginUrls().login;
    await this.navigateToLogin(loginUrl);
    await this.assertLoginPageValid();
    
    // Wait for and click Google login button
    const googleLoginButton = 'text=Continue with google';
    await this.waitForElement(googleLoginButton, 10000);
    await this.clickElement(googleLoginButton);
    
    console.log('Google login initiated');
  }

  /**
   * Step 2: Handle Google email input
   */
  private async handleGoogleEmailStep(): Promise<void> {
    console.log('Step 2: Handling Google email input');
    
    const { email } = this.getCredentials();
    
    // Wait for email field and enter email
    await this.waitForElement(this.googleSelectors.emailField, 15000);
    await this.fill(this.googleSelectors.emailField, email);
    
    // Click Next button
    await this.waitForElement(this.googleSelectors.emailNextButton, 5000);
    await this.clickElement(this.googleSelectors.emailNextButton);
    
    // Wait for navigation to password step
    await this.page.waitForTimeout(3000);
    
    console.log('Email step completed');
  }

  /**
   * Step 3: Handle Google password input
   */
  private async handleGooglePasswordStep(): Promise<void> {
    console.log('Step 3: Handling Google password input');
    
    const { password } = this.getCredentials();
    
    // Wait for password field and enter password
    await this.waitForElement(this.googleSelectors.passwordField, 15000);
    await this.fill(this.googleSelectors.passwordField, password);
    
    // Click Next button
    await this.waitForElement(this.googleSelectors.passwordNextButton, 5000);
    await this.clickElement(this.googleSelectors.passwordNextButton);
    
    // Wait for 2FA or next step
    await this.page.waitForTimeout(5000);
    
    console.log('Password step completed');
  }

  /**
   * Step 4: Handle 2FA selection (Try another way -> Google Authenticator OR direct selection)
   */
  private async handle2FASelection(): Promise<void> {
    console.log('Step 4: Handling 2FA selection');
    
    try {
      // Wait a moment for the 2FA page to load
      await this.page.waitForTimeout(2000);
      
      // Multiple possible selectors for Google Authenticator option
      const authenticatorSelectors = [
        'text=Get a verification code from the Google Authenticator app',
        'text=Google Authenticator',
        '[data-testid="authenticator-app"]',
        'div:has-text("Google Authenticator app")',
        'div:has-text("verification code from the Google Authenticator")',
        // More specific selectors based on the screenshot
        'div[role="button"]:has-text("Google Authenticator")',
        'button:has-text("Google Authenticator")'
      ];
      
      // First, try to find and click Google Authenticator option directly
      console.log('Looking for Google Authenticator option...');
      let authenticatorFound = false;
      
      for (const selector of authenticatorSelectors) {
        try {
          const isVisible = await this.isElementVisible(selector);
          console.log(`   Checking selector "${selector}": ${isVisible ? 'Found' : 'Not found'}`);
          
          if (isVisible) {
            console.log(`Found Google Authenticator option with selector: ${selector}`);
            await this.clickElement(selector);
            await this.page.waitForTimeout(3000);
            console.log('Google Authenticator selected directly');
            authenticatorFound = true;
            break;
          }
        } catch (error) {
          console.log(`   Error checking selector "${selector}": ${error}`);
          continue;
        }
      }
      
      // If not found directly, try "Try another way" approach
      if (!authenticatorFound) {
        console.log('Google Authenticator not found directly, trying "Try another way"...');
        const tryAnotherWayVisible = await this.isElementVisible(this.googleSelectors.tryAnotherWayButton);
        
        if (tryAnotherWayVisible) {
          console.log('"Try another way" option found, clicking...');
          await this.clickElement(this.googleSelectors.tryAnotherWayButton);
          await this.page.waitForTimeout(3000);
          
          // Now try to find Google Authenticator option again
          for (const selector of authenticatorSelectors) {
            try {
              const isVisible = await this.isElementVisible(selector);
              if (isVisible) {
                console.log(`Found Google Authenticator after "Try another way" with selector: ${selector}`);
                await this.clickElement(selector);
                await this.page.waitForTimeout(3000);
                console.log('Google Authenticator selected after "Try another way"');
                authenticatorFound = true;
                break;
              }
            } catch (error) {
              continue;
            }
          }
        }
      }
      
      if (!authenticatorFound) {
        console.log('WARNING: Google Authenticator option not found, but proceeding to TOTP step');
        // Take a screenshot for debugging
        await this.takeLoginScreenshot('2fa_selection_failed');
      }
      
    } catch (error) {
      console.log('️ 2FA selection step encountered error:', error);
      await this.takeLoginScreenshot('2fa_selection_error');
    }
  }

  /**
   * Step 5: Handle TOTP code input
   */
  private async handleTOTPStep(): Promise<void> {
    console.log('Step 5: Handling TOTP code input');
    
    if (!this.totpGenerator) {
      throw new Error('TOTP generator not initialized. Please check TOTP_SECRET_KEY environment variable.');
    }
    
    // Wait for OTP input field
    await this.waitForElement(this.googleSelectors.otpField, 15000);
    
    // Generate TOTP code with smart timing
    const totpCode = await this.totpGenerator.generateCodeWithTiming(3);
    
    // Enter TOTP code
    await this.fill(this.googleSelectors.otpField, totpCode);
    await this.page.waitForTimeout(1000);
    
    // Click Next button
    await this.waitForElement(this.googleSelectors.otpNextButton, 5000);
    await this.clickElement(this.googleSelectors.otpNextButton);
    
    // Wait for next step
    await this.page.waitForTimeout(5000);
    
    console.log('TOTP step completed');
  }

  /**
   * Step 6: Handle final consent/continue buttons
   */
  private async handleFinalConsent(): Promise<void> {
    console.log('Step 6: Handling final consent');
    
    try {
      // Wait a moment for the page to load
      await this.page.waitForTimeout(2000);
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
        console.log('   Network not idle, continuing...');
      });
      
      // Check if we're on device protection challenge page (common in headless mode)
      const currentUrl = this.page.url();
      if (currentUrl.includes('/challenge/dp')) {
        console.log('🔐 Device Protection (DP) challenge detected in headless mode');
        await this.handleDeviceProtectionChallenge();
        return;
      }
      
      // Look for various possible final consent buttons
      const possibleButtons = [
        this.googleSelectors.finalContinueButton,
        this.googleSelectors.allowButton,
        'text=Continue',
        'text=Allow',
        'button:has-text("Continue")',
        'button:has-text("Allow")'
      ];
      
      for (const buttonSelector of possibleButtons) {
        try {
          console.log(` Checking for button: ${buttonSelector}`);
          
          // Wait for the button with a reasonable timeout
          const button = this.page.locator(buttonSelector).first();
          await button.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
          
          const buttonVisible = await button.isVisible().catch(() => false);
          console.log(`   Button visible: ${buttonVisible}`);
          
          if (buttonVisible) {
            console.log(` Found final button: ${buttonSelector}`);
            console.log(` Waiting 5 seconds before clicking Continue button...`);
            await this.page.waitForTimeout(5000);
            console.log(` Wait complete, clicking button now`);
            await button.click();
            await this.page.waitForTimeout(3000);
            console.log(` Button clicked successfully`);
            break;
          }
        } catch (error) {
          console.log(`   Error checking button "${buttonSelector}": ${error}`);
          // Continue to next button option
          continue;
        }
      }

      
      console.log(' Final consent step completed');
      console.log(` Final URL after consent: ${this.page.url()}`);
    } catch (error) {
      console.log('ℹ Final consent step skipped or not needed:', error);
      console.log(` Current URL on error: ${this.page.url()}`);
      // Take screenshot for debugging
      await this.takeLoginScreenshot('final_consent_error').catch(() => {});
    }
  }

  /**
   * Handle device protection challenge (common in headless mode)
   */
  private async handleDeviceProtectionChallenge(): Promise<void> {
    console.log('🔐 Handling device protection challenge (headless mode)');
    
    try {
      // Wait for page to stabilize
      await this.page.waitForTimeout(3000);
      
      // Take a screenshot to see what's on the page
      await this.takeLoginScreenshot('dp_challenge_page');
      
      console.log(' Looking for "More ways to verify" button...');
      console.log(' Current URL:', this.page.url());
      
      // STEP 1: Look for "More ways to verify" button (mobile verification alternative)
      const moreWaysSelectors = [
        'button:has-text("More ways to verify")',
        'text=More ways to verify',
        '[role="button"]:has-text("More ways to verify")',
        'div:has-text("More ways to verify")',
        '[aria-label*="More ways"]',
        'button:has-text("Try another way")',
        'text=Try another way'
      ];
      
      let moreWaysClicked = false;
      for (const selector of moreWaysSelectors) {
        try {
          const button = this.page.locator(selector).first();
          const isVisible = await button.isVisible({ timeout: 3000 }).catch(() => false);
          
          if (isVisible) {
            console.log(` Found "More ways to verify" button: ${selector}`);
            await button.click();
            console.log(' Clicked "More ways to verify"');
            await this.page.waitForTimeout(3000);
            await this.takeLoginScreenshot('dp_after_more_ways');
            moreWaysClicked = true;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      
      if (moreWaysClicked) {
        console.log(' Looking for alternative verification options...');
        
        // STEP 2: After clicking "More ways to verify", look for authenticator/TOTP option
        const authenticatorSelectors = [
          'text=Use your authenticator app',
          'text=Get a verification code from the Google Authenticator app',
          'button:has-text("authenticator")',
          'div:has-text("authenticator app")',
          '[data-testid="authenticator-app"]',
          'button:has-text("Use another verification method")',
          'text=Get a code',
          'text=verification code'
        ];
        
        for (const selector of authenticatorSelectors) {
          try {
            const option = this.page.locator(selector).first();
            const isVisible = await option.isVisible({ timeout: 3000 }).catch(() => false);
            
            if (isVisible) {
              console.log(` Found authenticator option: ${selector}`);
              await option.click();
              console.log(' Clicked authenticator option');
              await this.page.waitForTimeout(3000);
              
              // Now we should be at TOTP input page - let the main flow handle it
              console.log(' DP challenge bypassed, should now be at TOTP input');
              return;
            }
          } catch (error) {
            continue;
          }
        }
      }
      
      // STEP 3: If no "More ways to verify" found, try other DP challenge buttons
      console.log(' Looking for other device protection confirmation buttons...');
      
      const dpSelectors = [
        // Trust device options
        'button:has-text("I know this device")',
        'button:has-text("Trust this device")',
        'button:has-text("This is my device")',
        'text=I know this device',
        'text=Trust this device',
        'text=This is my device',
        '[data-testid="trust-device"]',
        '[aria-label="Trust this device"]',
        
        // Continue/Next buttons on DP page
        'button:has-text("Continue")',
        'button:has-text("Next")',
        'button:has-text("Confirm")',
        'button:has-text("Yes")',
        '[role="button"]:has-text("Continue")',
        '[role="button"]:has-text("Next")',
        
        // Generic continue button
        this.googleSelectors.finalContinueButton
      ];
      
      let buttonFound = false;
      for (const selector of dpSelectors) {
        try {
          const button = this.page.locator(selector).first();
          const isVisible = await button.isVisible({ timeout: 2000 }).catch(() => false);
          
          if (isVisible) {
            console.log(` Found DP button: ${selector}`);
            await this.page.waitForTimeout(2000);
            await button.click();
            console.log(' Clicked device protection confirmation');
            await this.page.waitForTimeout(5000);
            buttonFound = true;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      
      if (!buttonFound && !moreWaysClicked) {
        console.log(' No verification options found, waiting for auto-redirect...');
        await this.page.waitForTimeout(10000);
      }
      
      // Final check
      const finalUrl = this.page.url();
      console.log(` Final URL after DP handling: ${finalUrl}`);
      
      if (finalUrl.includes('/challenge/dp')) {
        console.log(' Still on DP challenge page after all attempts');
        await this.takeLoginScreenshot('dp_challenge_failed');
        throw new Error('Unable to bypass Google Device Protection challenge. Please run in non-headless mode first or use saved authentication state.');
      } else {
        console.log(' Successfully bypassed DP challenge');
      }
      
    } catch (error) {
      console.error(' Error handling device protection challenge:', error);
      await this.takeLoginScreenshot('dp_challenge_error');
      throw error;
    }
  }

  /**
   * Step 7: Verify successful login
   */
  private async verifyLoginSuccess(): Promise<boolean> {
    console.log('Step 7: Verifying login success');
    
    try {
      // Wait for redirect away from auth pages
      await this.page.waitForTimeout(5000);
      
      const currentUrl = this.getCurrentUrl();
      console.log(`Current URL after login: ${currentUrl}`);
      
      // Check if we're no longer on Google auth pages
      const isOnGoogleAuth = currentUrl.includes('accounts.google.com') || 
                            currentUrl.includes('oauth') ||
                            currentUrl.includes('/auth');
      
      if (!isOnGoogleAuth) {
        console.log('Successfully redirected away from auth pages');
        return true;
      }
      
      // Additional checks for successful login indicators
      const successIndicators = [
        '[data-testid="user-menu"]',
        '[data-testid="logout"]',
        '.user-avatar',
        '.profile-menu'
      ];
      
      for (const indicator of successIndicators) {
        const indicatorVisible = await this.isElementVisible(indicator);
        if (indicatorVisible) {
          console.log(`Login success indicator found: ${indicator}`);
          return true;
        }
      }
      
      // Check if we're on a protected page (not login/auth)
      if (!currentUrl.includes('/auth') && !currentUrl.includes('login')) {
        console.log('On protected page, login likely successful');
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('Error verifying login success:', error);
      return false;
    }
  }

  /**
   * Check if there are any error messages during login
   */
  async hasLoginErrors(): Promise<boolean> {
    try {
      return await this.isElementVisible(this.googleSelectors.errorMessage);
    } catch {
      return false;
    }
  }

  /**
   * Get login error message if present
   */
  async getLoginErrorMessage(): Promise<string | null> {
    try {
      if (await this.hasLoginErrors()) {
        return await this.getElementText(this.googleSelectors.errorMessage);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Quick login method for simple test cases
   */
  async quickLogin(): Promise<boolean> {
    console.log('Performing quick Google OAuth + TOTP login');
    return await this.performCompleteLogin();
  }

  /**
   * Login with custom credentials (override environment variables)
   */
  async loginWithCredentials(email: string, password: string, totpSecret?: string): Promise<boolean> {
    console.log('Performing login with custom credentials');
    
    // Temporarily override environment variables
    const originalEmail = process.env.GOOGLE_EMAIL;
    const originalPassword = process.env.GOOGLE_PASSWORD;
    const originalTotpSecret = process.env.TOTP_SECRET_KEY;
    
    try {
      process.env.GOOGLE_EMAIL = email;
      process.env.GOOGLE_PASSWORD = password;
      if (totpSecret) {
        process.env.TOTP_SECRET_KEY = totpSecret;
        this.initializeTOTPGenerator();
      }
      
      return await this.performCompleteLogin();
      
    } finally {
      // Restore original environment variables
      if (originalEmail) process.env.GOOGLE_EMAIL = originalEmail;
      if (originalPassword) process.env.GOOGLE_PASSWORD = originalPassword;
      if (originalTotpSecret) process.env.TOTP_SECRET_KEY = originalTotpSecret;
      if (totpSecret) this.initializeTOTPGenerator();
    }
  }

  /**
   * Take screenshot with timestamp for debugging
   */
  async takeLoginScreenshot(step: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `google_oauth_login_${step}_${timestamp}.png`;
    return await this.takeScreenshot(filename);
  }
}
