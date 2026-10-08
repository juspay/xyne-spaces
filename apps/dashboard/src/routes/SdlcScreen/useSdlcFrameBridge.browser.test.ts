import { describe, expect, it } from 'vitest';
import { browserTabSearch } from './useSdlcFrameBridge';

describe('switching the open folder to its browser tab', () => {
  it('keeps the folder and track and drops other tab params', () => {
    expect(browserTabSearch('?track=t1&folder=f1&link=l1')).toBe('?track=t1&folder=f1&browse=1');
  });

  it('does nothing without an open folder or when already browsing', () => {
    expect(browserTabSearch('?track=t1')).toBeNull();
    expect(browserTabSearch('?folder=f1&browse=1')).toBeNull();
  });
});
