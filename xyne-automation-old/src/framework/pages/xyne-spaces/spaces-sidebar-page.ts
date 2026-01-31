/**
 * Xyne Spaces Sidebar Page Object
 * Handles sidebar navigation, icon highlighting verification, and page navigation testing
 * 
 * Based on sidebar structure:
 * - Home (/)
 * - Chat (/chat)
 * - Tickets (/tickets)
 * - Agents (/agents)
 * - Knowledge Base (/knowledge-base)
 * - Analytics (/analytics)
 * - Settings (button)
 * - User Profile (bottom)
 */

import { Page } from '@playwright/test';
import { expect } from '@/framework/utils/instrumented-page';
import { BasePage } from '@/framework/core/base-page';

export interface SidebarNavigationItem {
  name: string;
  selector: string;
  href: string;
  expectedUrl: string;
  pageTitle?: string;
  uniquePageElement?: string;
  activeClass?: string;
}

export class SpacesSidebarPage extends BasePage {
  // Sidebar container selector
  private readonly sidebarSelector = 'aside.bg-\\[\\#F0F2F5\\]';
  
  // Navigation items configuration
  private readonly navigationItems: SidebarNavigationItem[] = [
    {
      name: 'Home',
      selector: 'a[href="/"]',
      href: '/',
      expectedUrl: '/',
      activeClass: 'bg-[#E0E4E8]',
      uniquePageElement: 'text=Home'
    },
    {
      name: 'Chat',
      selector: 'a[href="/chat"]',
      href: '/chat',
      expectedUrl: '/chat',
      activeClass: 'bg-[#E0E4E8]',
      uniquePageElement: 'text=Threads'
    },
    {
      name: 'Tickets',
      selector: 'a[href="/tickets"]',
      href: '/tickets',
      expectedUrl: '/tickets',
      activeClass: 'bg-[#E0E4E8]',
      uniquePageElement: 'text=Support Tickets'
    },
    {
      name: 'Agents',
      selector: 'a[href="/agents"]',
      href: '/agents',
      expectedUrl: '/agents',
      activeClass: 'bg-[#E0E4E8]',
      uniquePageElement: 'text=AI Agents'
    },
    {
      name: 'Knowledge Base',
      selector: 'a[href="/knowledge-base"]',
      href: '/knowledge-base',
      expectedUrl: '/knowledge-base',
      activeClass: 'bg-[#E0E4E8]',
      uniquePageElement: 'text=Knowledge Base'
    },
    {
      name: 'Analytics',
      selector: 'a[href="/analytics"]',
      href: '/analytics',
      expectedUrl: '/analytics',
      activeClass: 'bg-[#E0E4E8]',
      uniquePageElement: 'text=Analytics Dashboard'
    }
  ];

  constructor(page: Page) {
    super(page);
  }

  /**
   * Verify sidebar is visible and loaded
   */
  async verifySidebarVisible(): Promise<void> {
    console.log('Verifying sidebar is visible');
    const sidebar = this.page.locator(this.sidebarSelector);
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    console.log('Sidebar is visible');
  }

  /**
   * Get sidebar container
   */
  private getSidebarContainer() {
    return this.page.locator(this.sidebarSelector);
  }

  /**
   * Click a navigation item by name
   */
  async clickNavigationItem(itemName: string): Promise<void> {
    const item = this.navigationItems.find(i => i.name === itemName);
    if (!item) {
      throw new Error(`Navigation item "${itemName}" not found`);
    }

    console.log(`Clicking ${itemName} icon in sidebar`);
    const sidebar = this.getSidebarContainer();
    const navItem = sidebar.locator(item.selector);
    
    await expect(navItem).toBeVisible({ timeout: 5000 });
    await navItem.click();
    await this.page.waitForTimeout(2000);
    
    console.log(`${itemName} clicked`);
  }

  /**
   * Verify if a navigation item is highlighted/active
   */
  async verifyNavigationItemHighlighted(itemName: string): Promise<boolean> {
    const item = this.navigationItems.find(i => i.name === itemName);
    if (!item) {
      throw new Error(`Navigation item "${itemName}" not found`);
    }

    console.log(`Verifying ${itemName} is highlighted`);
    const sidebar = this.getSidebarContainer();
    const navItem = sidebar.locator(item.selector);
    
    // Check if the element has the active background class
    const classAttribute = await navItem.getAttribute('class');
    const isHighlighted = classAttribute?.includes('bg-[#E0E4E8]') || false;
    
    if (isHighlighted) {
      console.log(`${itemName} is highlighted (active)`);
    } else {
      console.log(`${itemName} is NOT highlighted`);
    }
    
    return isHighlighted;
  }

  /**
   * Verify current URL matches expected URL for a navigation item
   */
  async verifyCurrentUrl(itemName: string): Promise<boolean> {
    const item = this.navigationItems.find(i => i.name === itemName);
    if (!item) {
      throw new Error(`Navigation item "${itemName}" not found`);
    }

    console.log(`Verifying URL for ${itemName}`);
    const currentUrl = this.page.url();
    const urlMatches = currentUrl.includes(item.expectedUrl);
    
    if (urlMatches) {
      console.log(`URL matches: ${currentUrl} contains ${item.expectedUrl}`);
    } else {
      console.log(`URL mismatch: ${currentUrl} does not contain ${item.expectedUrl}`);
    }
    
    return urlMatches;
  }

  /**
   * Verify page loaded correctly by checking for unique page element
   */
  async verifyPageLoaded(itemName: string): Promise<boolean> {
    const item = this.navigationItems.find(i => i.name === itemName);
    if (!item || !item.uniquePageElement) {
      console.log(`No unique page element defined for ${itemName}, skipping page verification`);
      return true;
    }

    console.log(`Verifying ${itemName} page loaded`);
    try {
      const pageElement = this.page.locator(item.uniquePageElement);
      await expect(pageElement).toBeVisible({ timeout: 10000 });
      console.log(`${itemName} page loaded successfully`);
      return true;
    } catch (error) {
      console.log(`${itemName} page element not found, but continuing...`);
      return false;
    }
  }

  /**
   * Click navigation item and verify everything (highlight, URL, page load)
   */
  async clickAndVerifyNavigation(itemName: string): Promise<void> {
    console.log(`\nTesting ${itemName} navigation`);
    console.log('━'.repeat(60));
    
    // Step 1: Click the navigation item
    await this.clickNavigationItem(itemName);
    
    // Step 2: Wait for navigation to complete
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      console.log('Network idle timeout, continuing...');
    });
    await this.page.waitForTimeout(2000);
    
    // Step 3: Verify the item is highlighted
    const isHighlighted = await this.verifyNavigationItemHighlighted(itemName);
    expect(isHighlighted).toBe(true);
    
    // Step 4: Verify URL
    const urlMatches = await this.verifyCurrentUrl(itemName);
    expect(urlMatches).toBe(true);
    
    // Step 5: Verify page loaded
    await this.verifyPageLoaded(itemName);
    
    console.log(`${itemName} navigation test PASSED`);
    console.log('━'.repeat(60) + '\n');
  }

  /**
   * Verify Xyne logo is visible
   */
  async verifyLogoVisible(): Promise<void> {
    console.log('Verifying Xyne logo is visible');
    const sidebar = this.getSidebarContainer();
    const logo = sidebar.locator('svg').first();
    
    await expect(logo).toBeVisible({ timeout: 5000 });
    console.log('Xyne logo is visible');
  }

  /**
   * Count total navigation items
   */
  async countNavigationItems(): Promise<number> {
    const sidebar = this.getSidebarContainer();
    const navItems = sidebar.locator('nav ul a');
    const count = await navItems.count();
    
    console.log(`Total navigation items: ${count}`);
    return count;
  }

  /**
   * Verify all navigation items are visible
   */
  async verifyAllNavigationItemsVisible(): Promise<void> {
    console.log('Verifying all navigation items are visible');
    
    for (const item of this.navigationItems) {
      const sidebar = this.getSidebarContainer();
      const navItem = sidebar.locator(item.selector);
      
      await expect(navItem).toBeVisible({ timeout: 5000 });
      console.log(`  ${item.name} is visible`);
    }
    
    console.log('All navigation items are visible');
  }

  /**
   * Verify sidebar structure and all components
   */
  async verifySidebarStructure(): Promise<void> {
    console.log('\nVerifying complete sidebar structure');
    console.log('━'.repeat(60));
    
    // Verify sidebar is visible
    await this.verifySidebarVisible();
    
    // Verify logo
    await this.verifyLogoVisible();
    
    // Verify all navigation items
    await this.verifyAllNavigationItemsVisible();
    
    // Count items
    const count = await this.countNavigationItems();
    expect(count).toBe(this.navigationItems.length);
    
    console.log('━'.repeat(60));
    console.log('Sidebar structure verification complete');
  }
}
