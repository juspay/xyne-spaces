/**
 * Xyne Spaces Sidebar Navigation Tests - Using Test Orchestrator
 * 
 * This test suite validates:
 * 1. Sidebar structure and visibility
 * 2. Navigation to each page via sidebar icons
 * 3. Active/highlight state of clicked icons
 * 4. URL navigation correctness
 * 5. Page load verification
 */

import { TestOrchestrator } from '@/framework/utils/test-orchestrator';
import { step } from '@/framework/utils/step-tracker';
import { SpacesLoginHelper } from '@/framework/pages/xyne-spaces/spaces-login-helper';
import { SpacesSidebarPage } from '@/framework/pages/xyne-spaces/spaces-sidebar-page';

const orchestrator = new TestOrchestrator({
  useSharedPage: true,
  continueOnFailure: false,
  sequential: true,
  logLevel: 'detailed'
});

// Shared state
let sidebarPage: SpacesSidebarPage;

orchestrator.createSuite('Spaces - Sidebar Navigation Tests', [
  {
    name: 'login to Spaces and initialize sidebar page',
    metadata: { priority: 'highest', tags: ['@critical', '@spaces', '@setup'] },
    testFunction: async ({ sharedPage }) => {
      await step('Login to Xyne Spaces', async () => {
        console.log('Logging into Xyne Spaces...');
        await SpacesLoginHelper.performLogin(sharedPage.page);
        console.log('Login completed');
      });

      await step('Wait for page to be ready', async () => {
        await sharedPage.page.waitForLoadState('networkidle');
        await sharedPage.page.waitForTimeout(3000);
        console.log('Page ready');
      });

      await step('Initialize sidebar page object', async () => {
        sidebarPage = new SpacesSidebarPage(sharedPage.page);
        console.log('Sidebar page initialized');
      });
    }
  },

  {
    name: 'verify sidebar structure and all components are visible',
    dependencies: ['login to Spaces and initialize sidebar page'],
    metadata: { priority: 'high', tags: ['@core', '@sidebar', '@structure'] },
    testFunction: async () => {
      await step('Verify complete sidebar structure', async () => {
        await sidebarPage.verifySidebarStructure();
      });
    }
  },

  {
    name: 'verify Home icon is highlighted after login',
    dependencies: ['verify sidebar structure and all components are visible'],
    metadata: { priority: 'high', tags: ['@core', '@sidebar', '@validation'] },
    testFunction: async () => {
      await step('Verify Home icon is already highlighted', async () => {
        const isHighlighted = await sidebarPage.verifyNavigationItemHighlighted('Home');
        if (!isHighlighted) {
          throw new Error('Home should be highlighted after login');
        }
        console.log('Home icon is highlighted (we are on Home page after login)');
      });
    }
  },

  {
    name: 'navigate to Chat and verify icon highlight',
    dependencies: ['verify Home icon is highlighted after login'],
    metadata: { priority: 'high', tags: ['@core', '@sidebar', '@navigation'] },
    testFunction: async () => {
      await step('Click Chat icon and verify navigation', async () => {
        await sidebarPage.clickAndVerifyNavigation('Chat');
      });
    }
  },

  {
    name: 'navigate to Tickets and verify icon highlight',
    dependencies: ['navigate to Chat and verify icon highlight'],
    metadata: { priority: 'high', tags: ['@core', '@sidebar', '@navigation'] },
    testFunction: async () => {
      await step('Click Tickets icon and verify navigation', async () => {
        await sidebarPage.clickAndVerifyNavigation('Tickets');
      });
    }
  },

  {
    name: 'navigate to Agents and verify icon highlight',
    dependencies: ['navigate to Tickets and verify icon highlight'],
    metadata: { priority: 'high', tags: ['@core', '@sidebar', '@navigation'] },
    testFunction: async () => {
      await step('Click Agents icon and verify navigation', async () => {
        await sidebarPage.clickAndVerifyNavigation('Agents');
      });
    }
  },

  {
    name: 'navigate to Knowledge Base and verify icon highlight',
    dependencies: ['navigate to Agents and verify icon highlight'],
    metadata: { priority: 'high', tags: ['@core', '@sidebar', '@navigation'] },
    testFunction: async () => {
      await step('Click Knowledge Base icon and verify navigation', async () => {
        await sidebarPage.clickAndVerifyNavigation('Knowledge Base');
      });
    }
  },

  {
    name: 'navigate to Analytics and verify icon highlight',
    dependencies: ['navigate to Knowledge Base and verify icon highlight'],
    metadata: { priority: 'high', tags: ['@core', '@sidebar', '@navigation'] },
    testFunction: async () => {
      await step('Click Analytics icon and verify navigation', async () => {
        await sidebarPage.clickAndVerifyNavigation('Analytics');
      });
    }
  },

  {
    name: 'navigate back to Home and verify icon highlight',
    dependencies: ['navigate to Analytics and verify icon highlight'],
    metadata: { priority: 'high', tags: ['@core', '@sidebar', '@navigation'] },
    testFunction: async () => {
      await step('Click Home icon and verify navigation', async () => {
        await sidebarPage.clickAndVerifyNavigation('Home');
      });
    }
  }
]);
