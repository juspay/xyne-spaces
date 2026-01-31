/**
 * Test Orchestrator Example
 * Demonstrates the new generic test orchestrator utility with various patterns
 */

import { expect } from '@playwright/test';
import { 
  TestOrchestrator, 
  runIfAllPass, 
  runRegardless,
  createOrchestratedTest 
} from '@/framework/utils/test-orchestrator';

// Example 1: Basic orchestrated test suite with dependencies
const basicOrchestrator = new TestOrchestrator({
  logLevel: 'detailed',
  useSharedPage: true,
  sequential: true
});

basicOrchestrator.createSuite('E-commerce User Journey', [
  {
    name: 'setup test environment',
    metadata: { priority: 'highest', tags: ['@setup'] },
    testFunction: async ({ sharedPage }) => {
      console.log(' Setting up test environment');
      const { page } = sharedPage;
      
      // Navigate to the application
      await page.goto('https://example.com');
      await expect(page.locator('body')).toBeVisible();
      console.log(' Test environment ready');
    }
  },
  
  {
    name: 'user login',
    dependencies: ['setup test environment'], // Only runs if setup passes
    metadata: { priority: 'high', tags: ['@auth', '@critical'] },
    testFunction: async ({ sharedPage }) => {
      console.log(' Performing user login');
      const { page } = sharedPage;
      
      // Simulate login process
      await page.click('#login-button');
      await page.fill('#username', 'testuser@example.com');
      await page.fill('#password', 'securepassword');
      await page.click('#submit-login');
      
      // Verify login success
      await expect(page.locator('.welcome-message')).toBeVisible({ timeout: 5000 });
      console.log(' User login successful');
    }
  },
  
  {
    name: 'browse products',
    dependencies: ['user login'], // Only runs if login passes
    metadata: { priority: 'high', tags: ['@products'] },
    testFunction: async ({ sharedPage }) => {
      console.log('️ Browsing products');
      const { page } = sharedPage;
      
      // Navigate to products page
      await page.click('a[href="/products"]');
      await expect(page.locator('.product-grid')).toBeVisible();
      
      // Verify products are loaded
      const productCount = await page.locator('.product-item').count();
      expect(productCount).toBeGreaterThan(0);
      console.log(` Found ${productCount} products`);
    }
  },
  
  {
    name: 'add item to cart',
    dependencies: ['browse products'], // Only runs if browsing passes
    metadata: { priority: 'medium', tags: ['@cart'] },
    testFunction: async ({ sharedPage }) => {
      console.log('🛒 Adding item to cart');
      const { page } = sharedPage;
      
      // Add first product to cart
      await page.click('.product-item:first-child .add-to-cart-btn');
      await expect(page.locator('.cart-notification')).toBeVisible();
      
      // Verify cart count updated
      const cartCount = await page.locator('.cart-count').textContent();
      expect(parseInt(cartCount || '0')).toBeGreaterThan(0);
      console.log(' Item added to cart successfully');
    }
  },
  
  {
    name: 'proceed to checkout',
    dependencies: ['add item to cart'], // Only runs if cart has items
    metadata: { priority: 'medium', tags: ['@checkout'] },
    timeout: 30000, // Custom timeout for checkout process
    testFunction: async ({ sharedPage }) => {
      console.log('💳 Proceeding to checkout');
      const { page } = sharedPage;
      
      // Go to cart and checkout
      await page.click('.cart-icon');
      await page.click('#checkout-button');
      
      // Fill checkout form
      await page.fill('#billing-name', 'John Doe');
      await page.fill('#billing-email', 'john@example.com');
      await page.fill('#billing-address', '123 Test Street');
      
      // Verify checkout form is ready
      await expect(page.locator('#payment-section')).toBeVisible();
      console.log(' Checkout process initiated');
    }
  },
  
  {
    name: 'cleanup and logout',
    runRegardless: true, // Always runs, regardless of previous test results
    metadata: { priority: 'low', tags: ['@cleanup'] },
    testFunction: async ({ sharedPage }) => {
      console.log(' Performing cleanup and logout');
      const { page } = sharedPage;
      
      try {
        // Clear cart if possible
        await page.evaluate(() => {
          localStorage.removeItem('cart');
          sessionStorage.clear();
        });
        
        // Logout if user menu is available
        const userMenu = page.locator('#user-menu');
        if (await userMenu.isVisible()) {
          await userMenu.click();
          await page.click('#logout-button');
        }
        
        console.log(' Cleanup completed successfully');
      } catch (error) {
        console.log('️ Cleanup completed with warnings:', error);
      }
    }
  }
]);

// Example 2: Advanced orchestrator with custom conditions
const advancedOrchestrator = new TestOrchestrator({
  logLevel: 'verbose',
  continueOnFailure: true, // Continue even if some tests fail
  useSharedPage: true
});

advancedOrchestrator.createSuite('Advanced Feature Testing', [
  {
    name: 'feature A test',
    metadata: { priority: 'high', tags: ['@feature-a'] },
    testFunction: async ({ sharedPage }) => {
      console.log(' Testing Feature A');
      const { page } = sharedPage;
      
      await page.goto('https://example.com/feature-a');
      await expect(page.locator('#feature-a-content')).toBeVisible();
      console.log(' Feature A test passed');
    }
  },
  
  {
    name: 'feature B test',
    metadata: { priority: 'high', tags: ['@feature-b'] },
    testFunction: async ({ sharedPage }) => {
      console.log(' Testing Feature B');
      const { page } = sharedPage;
      
      await page.goto('https://example.com/feature-b');
      
      // Intentionally fail this test to demonstrate conditional execution
      throw new Error('Feature B test failed - demonstrating conditional execution');
    }
  },
  
  {
    name: 'integration test A+B',
    dependencies: ['feature A test', 'feature B test'], // Requires both features
    testFunction: async ({ sharedPage }) => {
      console.log('🔗 Testing A+B integration');
      // This will be skipped because Feature B failed
      const { page } = sharedPage;
      await page.goto('https://example.com/integration');
      console.log(' Integration test passed');
    }
  },
  
  {
    name: 'feature C test',
    dependencies: [
      { testName: 'feature A test', required: true },
      { testName: 'feature B test', required: false } // Optional dependency
    ],
    testFunction: async ({ sharedPage }) => {
      console.log(' Testing Feature C (depends on A, B optional)');
      // This will run because Feature A passed (B is optional)
      const { page } = sharedPage;
      await page.goto('https://example.com/feature-c');
      await expect(page.locator('#feature-c-content')).toBeVisible();
      console.log(' Feature C test passed');
    }
  },
  
  {
    name: 'conditional feature test',
    customCondition: (results) => {
      // Custom logic: only run if we have at least 2 passed tests
      const passedTests = Array.from(results.values()).filter(r => r.status === 'passed');
      const shouldRun = passedTests.length >= 2;
      
      return {
        shouldRun,
        reason: shouldRun ? undefined : `Need at least 2 passed tests, got ${passedTests.length}`
      };
    },
    testFunction: async ({ sharedPage }) => {
      console.log('🎯 Running conditional feature test');
      const { page } = sharedPage;
      
      await page.goto('https://example.com/conditional-feature');
      await expect(page.locator('#conditional-content')).toBeVisible();
      console.log(' Conditional feature test passed');
    }
  },
  
  {
    name: 'final cleanup',
    runRegardless: true, // Always runs
    testFunction: async ({ sharedPage }) => {
      console.log('🏁 Final cleanup (always runs)');
      const { page } = sharedPage;
      
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      console.log(' Final cleanup completed');
    }
  }
]);

// Example 3: Using convenience functions
runIfAllPass(
  'comprehensive user flow',
  ['user login', 'browse products', 'add item to cart'], // All must pass
  async ({ sharedPage }) => {
    console.log('🎯 Running comprehensive user flow');
    const { page } = sharedPage;
    
    // This only runs if login, browsing, and cart addition all passed
    await page.goto('https://example.com/user-dashboard');
    await expect(page.locator('.user-dashboard')).toBeVisible();
    
    // Verify user has items in cart
    const cartItems = await page.locator('.cart-item').count();
    expect(cartItems).toBeGreaterThan(0);
    
    console.log(' Comprehensive user flow completed');
  },
  {
    useSharedPage: true,
    metadata: { priority: 'medium', tags: ['@integration', '@user-flow'] },
    timeout: 45000
  }
);

runRegardless(
  'system health check',
  async ({ sharedPage }) => {
    console.log('🏥 Running system health check (always runs)');
    const { page } = sharedPage;
    
    // This always runs, regardless of other test results
    await page.goto('https://example.com/health');
    
    try {
      await expect(page.locator('#health-status')).toContainText('OK');
      console.log(' System health check passed');
    } catch (error) {
      console.log('️ System health check failed:', error);
      // Don't throw - this is just a health check
    }
  },
  {
    useSharedPage: true,
    metadata: { priority: 'low', tags: ['@health', '@monitoring'] }
  }
);

// Example 4: Simple orchestrated test using createOrchestratedTest
createOrchestratedTest(
  'payment processing test',
  ['user login', 'add item to cart'], // Dependencies
  async ({ sharedPage }) => {
    console.log('💰 Testing payment processing');
    const { page } = sharedPage;
    
    // This only runs if both login and cart addition passed
    await page.goto('https://example.com/payment');
    await page.fill('#card-number', '4111111111111111');
    await page.fill('#expiry', '12/25');
    await page.fill('#cvv', '123');
    
    await expect(page.locator('#payment-form')).toBeVisible();
    console.log(' Payment processing test completed');
  },
  {
    useSharedPage: true,
    metadata: { 
      priority: 'high', 
      tags: ['@payment', '@critical'] 
    },
    timeout: 20000
  }
);

// Example 5: Demonstrating error handling and recovery
const errorHandlingOrchestrator = new TestOrchestrator({
  logLevel: 'detailed',
  continueOnFailure: true, // Continue even when tests fail
  useSharedPage: true
});

errorHandlingOrchestrator.createSuite('Error Handling Demo', [
  {
    name: 'stable test',
    testFunction: async ({ sharedPage }) => {
      console.log(' This test always passes');
      const { page } = sharedPage;
      await page.goto('https://example.com');
    }
  },
  
  {
    name: 'failing test',
    dependencies: ['stable test'],
    testFunction: async ({ sharedPage }) => {
      console.log(' This test will fail');
      throw new Error('Intentional failure for demonstration');
    }
  },
  
  {
    name: 'dependent on failing test',
    dependencies: ['failing test'],
    testFunction: async ({ sharedPage }) => {
      console.log('⏭ This will be skipped due to failed dependency');
      // This won't run because 'failing test' failed
    }
  },
  
  {
    name: 'independent test',
    dependencies: ['stable test'], // Only depends on stable test
    testFunction: async ({ sharedPage }) => {
      console.log(' This runs because it only depends on stable test');
      const { page } = sharedPage;
      await expect(page.locator('body')).toBeVisible();
    }
  },
  
  {
    name: 'recovery test',
    runRegardless: true, // Always runs
    testFunction: async ({ sharedPage }) => {
      console.log('🔄 This always runs for recovery/cleanup');
      const { page } = sharedPage;
      
      // Perform any necessary recovery actions
      await page.evaluate(() => {
        console.log('Recovery actions performed');
      });
    }
  }
]);
