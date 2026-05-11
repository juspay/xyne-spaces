import { test as base } from '@playwright/test';

import { Config, config } from '@/config';

/**
 * Extended test fixture with configuration access
 */
export const test = base.extend<{
  config: Config;
}>({
  config: async (_, use) => {
    await use(config);
  },
});

export { expect } from '@playwright/test';
