import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BUNDLE = new URL('../lib/vendor/spaces-sdk.js', import.meta.url);

describe('slim spaces SDK bundle', () => {
  it('stays under the sandbox 64 KB per-file cap', () => {
    expect(statSync(BUNDLE).size).toBeLessThan(64 * 1024);
  });

  it('includes the supportTickets, workspace and forms resources', async () => {
    const { createClient } = await import('../lib/vendor/spaces-sdk.js');
    const client = createClient({ baseUrl: 'http://localhost' });
    expect(typeof client.supportTickets.listFiltered).toBe('function');
    expect(typeof client.workspace.listMerchants).toBe('function');
    expect(typeof client.forms.list).toBe('function');
    expect(typeof client.forms.listValues).toBe('function');
  });
});
