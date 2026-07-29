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
      element: '[data-testid="open-dms-button"]',
      popover: {
        title: 'Dedicated DMs View',
        description: 'Click this button to open the full-screen Direct Messages workspace.',
        side: 'right',
      },
    },
    {
      element: '#sidebar-add-dm-btn',
      popover: {
        title: 'Quick Add DM',
        description: 'You can also instantly start a new conversation right here from the sidebar!',
        side: 'right',
      },
      onHighlightStarted: (element?: Element) => {
        if (element) (element as HTMLElement).style.opacity = '1';
      },
      onDeselected: (element?: Element) => {
        if (element) (element as HTMLElement).style.opacity = '';
      },
    },
  ],
};
