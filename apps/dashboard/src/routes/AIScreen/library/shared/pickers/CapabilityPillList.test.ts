import { describe, expect, it } from 'vitest';
import { fitPills } from './CapabilityPillList';

// Pills are 100px, gaps 8px. "+N more" is 80px, Add is 70px.
describe('fitPills', () => {
  it('shows every pill when they fit next to Add', () => {
    // 3 pills (316) + gap + Add (70) = 394
    expect(fitPills([100, 100, 100], 394, 70, 80)).toBeNull();
  });

  it('folds the rest into "+N more" when they don\'t', () => {
    // Room for pills: 393 - (70 + 8) - 80 - 8 = 227, so two pills (208).
    expect(fitPills([100, 100, 100, 100], 393, 70, 80)).toEqual({ count: 2, width: 208 });
  });

  it('leaves no room for Add when it is hidden (viewing)', () => {
    // Room: 300 - 80 - 8 = 212, so two pills.
    expect(fitPills([100, 100, 100, 100], 300, 0, 80)).toEqual({ count: 2, width: 208 });
  });

  it('always keeps one pill, cut to the room left', () => {
    expect(fitPills([400, 100], 300, 0, 80)).toEqual({ count: 1, width: 212 });
  });

  it('has nothing to fold in an empty row', () => {
    expect(fitPills([], 10, 70, 80)).toBeNull();
  });
});
