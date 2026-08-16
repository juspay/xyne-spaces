import { baselineWikiState } from '../../src/sdlc/baselineWikiContext';

describe('baselineWikiState', () => {
  it('uses only a completed successful Wiki', () => {
    expect(baselineWikiState({ executionStatus: 'SUCCESS', phase: 'COMPLETED' })).toBe('AVAILABLE');
  });

  it.each(['NEW', 'PENDING', 'SCHEDULED', 'RUNNING'])(
    'does not wait for or read a %s Wiki run',
    (executionStatus) => {
      expect(baselineWikiState({ executionStatus, phase: 'PROCESSING' })).toBe('GENERATING');
    }
  );

  it('works without any Wiki run', () => {
    expect(baselineWikiState(null)).toBe('UNAVAILABLE');
  });
});
