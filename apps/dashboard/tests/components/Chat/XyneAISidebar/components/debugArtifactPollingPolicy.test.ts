import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { debugArtifactFailureState } from '../../../../../src/components/Chat/XyneAISidebar/components/debugArtifactPollingPolicy.ts';

void describe('debugArtifactFailureState', () => {
  void it('keeps a running external debugger in a stable loading state', () => {
    assert.deepEqual(
      debugArtifactFailureState({ running: true, hasBundle: false, hasLiveEvents: false }),
      { showError: false, keepLoading: true },
    );
  });

  void it('surfaces a real missing-artifact error after the run stops', () => {
    assert.deepEqual(
      debugArtifactFailureState({ running: false, hasBundle: false, hasLiveEvents: false }),
      { showError: true, keepLoading: false },
    );
  });
});
