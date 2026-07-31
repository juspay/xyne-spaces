jest.mock('@/config/env', () => ({
  config: { frontendUrl: 'http://dashboard:5173' },
}));

import { buildInternalCallUrl } from './urlUtils';

describe('buildInternalCallUrl', () => {
  it('uses the configured frontend origin and encodes path and query values', () => {
    expect(buildInternalCallUrl('call/with spaces', 'VIDEO&admin=true')).toBe(
      'http://dashboard:5173/call/call%2Fwith%20spaces?type=VIDEO%26admin%3Dtrue'
    );
  });
});
