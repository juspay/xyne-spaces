/**
 * Login page object model for Xyne authentication
 * TypeScript equivalent of Python's LoginPage
 */

import { Page } from '@playwright/test';
import { BasePage } from '../../core/base-page';
import { LoginPageElements } from '@/types/index';

export class LoginPage extends BasePage {
  private selectors = {
    pageTitle: 'h1, h2, [data-testid="login-title"]',
    loginHeading: 'text=Welcome Back',
    subtitle: 'text=Please click on the button to sign in',
    enterpriseHeading: 'h1.text-\\[32px\\]', // Targeting the h1 tag for the enterprise heading
    enterpriseSubtitle: 'p.text-base.font-normal', // Targeting the p tag for the enterprise subtitle
    googleLoginButton: 'text=Sign in with Google',
    loginContainer: '[class*="login"], [class*="auth"], .card, [data-testid="login-container"]',
    errorMessage: '[class*="error"], [data-testid="error-message"]',
    loadingIndicator: '[class*="loading"], [data-testid="loading"]'
  };

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to the login page
   */
  async navigateToLogin(url: string): Promise<void> {
    console.log(`Navigating to login page: ${url}`);
    await this.navigate(url);
    await this.waitForPageLoad();
  }

  /**
   * Wait for login page to fully load
   */
  async waitForLoginPageLoad(timeout?: number): Promise<void> {
    console.log('Waiting for login page to load');
    
    // Wait for the main login heading to be visible
    await this.waitForElement(this.selectors.loginHeading, timeout);
    
    // Additional wait for page stability
    await this.waitForNetworkIdle();
  }

  /**
   * Check if login page is properly loaded
   */
  async isLoginPageLoaded(): Promise<boolean> {
    try {
      // Check for key elements that should be present on login page
      const loginHeadingVisible = await this.isElementVisible(this.selectors.loginHeading);
      const googleButtonVisible = await this.isElementVisible(this.selectors.googleLoginButton);
      
      console.log(`Login page validation - Heading: ${loginHeadingVisible}, Button: ${googleButtonVisible}`);
      return loginHeadingVisible && googleButtonVisible;
    } catch (error) {
      console.error('Error checking login page load status:', error);
      return false;
    }
  }

  /**
   * Get the main login heading text
   */
  async getLoginHeadingText(): Promise<string | null> {
    try {
      return await this.getElementText(this.selectors.loginHeading);
    } catch (error) {
      console.error('Error getting login heading text:', error);
      return null;
    }
  }

  /**
   * Get the subtitle text
   */
  async getSubtitleText(): Promise<string | null> {
    try {
      return await this.getElementText(this.selectors.subtitle);
    } catch (error) {
      console.error('Error getting subtitle text:', error);
      return null;
    }
  }

  /**
   * Get the enterprise heading text
   */
  async getEnterpriseHeadingText(): Promise<string | null> {
    try {
      return await this.getElementText(this.selectors.enterpriseHeading);
    } catch (error) {
      console.error('Error getting enterprise heading text:', error);
      return null;
    }
  }

  /**
   * Get the enterprise subtitle text
   */
  async getEnterpriseSubtitleText(): Promise<string | null> {
    try {
      return await this.getElementText(this.selectors.enterpriseSubtitle);
    } catch (error) {
      console.error('Error getting enterprise subtitle text:', error);
      return null;
    }
  }

  /**
   * Check if Google login button is visible
   */
  async isGoogleLoginButtonVisible(): Promise<boolean> {
    return await this.isElementVisible(this.selectors.googleLoginButton);
  }

  /**
   * Check if Google login button is enabled
   */
  async isGoogleLoginButtonEnabled(): Promise<boolean> {
    try {
      return await this.isElementEnabled(this.selectors.googleLoginButton);
    } catch (error) {
      console.error('Error checking Google login button state:', error);
      return false;
    }
  }

  /**
   * Click the Google login button
   */
  async clickGoogleLoginButton(): Promise<void> {
    console.log('Clicking Google login button');
    await this.clickElement(this.selectors.googleLoginButton);
  }

  /**
   * Check if login container/card is visible
   */
  async isLoginContainerVisible(): Promise<boolean> {
    return await this.isElementVisible(this.selectors.loginContainer);
  }

  /**
   * Check if there's an error message displayed
   */
  async hasErrorMessage(): Promise<boolean> {
    return await this.isElementVisible(this.selectors.errorMessage);
  }

  /**
   * Get error message text if present
   */
  async getErrorMessage(): Promise<string | null> {
    try {
      if (await this.hasErrorMessage()) {
        return await this.getElementText(this.selectors.errorMessage);
      }
      return null;
    } catch (error) {
      console.error('Error getting error message:', error);
      return null;
    }
  }

  /**
   * Check if page is in loading state
   */
  async isLoading(): Promise<boolean> {
    return await this.isElementVisible(this.selectors.loadingIndicator);
  }

  /**
   * Comprehensive validation of all login page elements
   */
  async validateLoginPageElements(): Promise<LoginPageElements> {
    console.log('Performing comprehensive login page validation');
    
    const validation: LoginPageElements = {
      pageLoaded: await this.isLoginPageLoaded(),
      pageTitle: await this.getPageTitle(),
      loginHeading: await this.getLoginHeadingText(),
      subtitle: await this.getSubtitleText(),
      enterpriseHeading: await this.getEnterpriseHeadingText(),
      enterpriseSubtitle: await this.getEnterpriseSubtitleText(),
      googleButtonVisible: await this.isGoogleLoginButtonVisible(),
      googleButtonEnabled: await this.isGoogleLoginButtonEnabled(),
      loginContainerVisible: await this.isLoginContainerVisible(),
      hasErrors: await this.hasErrorMessage(),
      errorMessage: await this.getErrorMessage(),
      isLoading: await this.isLoading(),
      currentUrl: this.getCurrentUrl()
    };
    
    console.log('Login page validation results:', validation);
    return validation;
  }

  /**
   * Wait for redirect after login attempt
   */
  async waitForRedirectAfterLogin(expectedUrlPattern?: string, timeout?: number): Promise<boolean> {
    console.log('Waiting for redirect after login');
    
    try {
      if (expectedUrlPattern) {
        await this.waitForUrlContains(expectedUrlPattern, timeout);
      } else {
        // Wait for URL to change from login page
        await this.waitForCondition(
          async () => !this.getCurrentUrl().includes('/auth'),
          timeout || this.config.timeout.navigation
        );
      }
      return true;
    } catch (error) {
      console.error('Timeout waiting for redirect:', error);
      return false;
    }
  }

  /**
   * Take screenshot of login page
   */
  async takeLoginPageScreenshot(filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotName = filename || `login_page_${timestamp}.png`;
    return await this.takeScreenshot(screenshotName);
  }

  /**
   * Validate login page with assertions
   */
  async assertLoginPageValid(): Promise<void> {
    // Core login page assertions
    await this.assertElementVisible(this.selectors.loginHeading, 'Login heading should be visible');
    await this.assertElementHasText(this.selectors.loginHeading, 'Welcome Back', 'Should contain "Welcome Back" text');
    await this.assertElementVisible(this.selectors.subtitle, 'Subtitle should be visible');
    await this.assertElementHasText(
      this.selectors.subtitle,
      'Please click on the button to sign in',
      'Should contain correct subtitle text'
    );

    // Enterprise text validation
    const expectedEnterpriseHeading = "The Unified AI Platform<br>for your enterprise";
    await this.assertElementHasHTML(this.selectors.enterpriseHeading, expectedEnterpriseHeading, 'Should contain correct enterprise heading text');

    const expectedEnterpriseSubtitle = "The full-stack AI OS that's open-source,<br>on-prem, and enterprise-grade with determinism &<br>governance built-in by design.";
    await this.assertElementHasHTML(this.selectors.enterpriseSubtitle, expectedEnterpriseSubtitle, 'Should contain correct enterprise subtitle text');

    await this.assertElementVisible(this.selectors.googleLoginButton, 'Google login button should be visible');
    await this.assertUrlContains('/auth', 'Should be on auth page');
  }

  /**
   * Get all login page URLs
   */
  getLoginUrls() {
    return {
      login: this.config.baseUrl + '/auth',
      base: this.config.baseUrl,
      chat: this.config.baseUrl + '/chat',
      api: this.config.apiBaseUrl
    };
  }
}
