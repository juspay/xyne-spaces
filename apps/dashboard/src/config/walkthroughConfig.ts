import { DriveStep } from 'driver.js';

export type WalkthroughFeature = 'direct_messages';

export const walkthroughConfig: Record<WalkthroughFeature, DriveStep[]> = {
  direct_messages: [
    {
      popover: {
        title: 'Direct Messages',
        description: 'Welcome! This tour will show you how to manage your Direct Messages.',
      },
    },
    {
      element: '[data-testid="search-messages-input"]',
      popover: {
        title: 'Find a Conversation',
        description: 'Search across all your direct messages to quickly jump to any chat.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-testid="create-new-message-btn"]',
      popover: {
        title: 'Start a New Message',
        description: 'Click here to start a new direct message with anyone on your team.',
        side: 'bottom',
        align: 'end',
      },
    },
  ],
};
