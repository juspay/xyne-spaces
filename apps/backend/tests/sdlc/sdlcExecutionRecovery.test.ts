import { shouldHandleSdlcCallback } from '../../src/sdlc/sdlcCallbackPolicy';
import { isGenericWorkflowRecoveryType } from '@/workflows/polling/workflowRecoveryPolicy';

describe('SDLC execution recovery', () => {
  it.each(['SDLC_SETUP', 'SDLC_WORK', 'SDLC_WIKI'])(
    'does not expose %s executions to generic workflow recovery',
    (workflowType) => {
      expect(isGenericWorkflowRecoveryType(workflowType)).toBe(false);
    }
  );

  it('continues recovering ordinary workflows', () => {
    expect(isGenericWorkflowRecoveryType('MESSAGE_RECEIVED')).toBe(true);
    expect(isGenericWorkflowRecoveryType(null)).toBe(true);
  });

  it('accepts a matching callback after legacy recovery changed RUNNING to PENDING', () => {
    expect(
      shouldHandleSdlcCallback({
        executionStatus: 'PENDING',
        expectedSessionId: 'session-1',
        callbackSessionId: 'session-1',
      })
    ).toBe(true);
  });

  it('rejects stale callbacks and callbacks for terminal executions', () => {
    expect(
      shouldHandleSdlcCallback({
        executionStatus: 'PENDING',
        expectedSessionId: 'session-2',
        callbackSessionId: 'session-1',
      })
    ).toBe(false);
    expect(
      shouldHandleSdlcCallback({
        executionStatus: 'FAILURE',
        expectedSessionId: 'session-1',
        callbackSessionId: 'session-1',
      })
    ).toBe(false);
  });
});
