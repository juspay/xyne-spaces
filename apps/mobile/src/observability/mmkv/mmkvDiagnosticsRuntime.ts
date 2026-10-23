import crashlytics from '@react-native-firebase/crashlytics';

import { logger } from '@/src/observability/logging/appLogger';
import { loadHandoffLastOp, shouldPublishHandoffLastOp } from '@/src/storage/mmkv/lastHandoffOp';

/**
 * Publish the last suspend-eligible App Group MMKV op after a kill.
 * Does nothing on a normal foreground launch.
 */
export function recoverMmkvDiagnostics(): void {
  try {
    const lastOp = loadHandoffLastOp();
    if (!lastOp || !shouldPublishHandoffLastOp(lastOp)) {
      return;
    }

    const ageMs = Date.now() - lastOp.ts;
    void crashlytics().setAttributes({
      mmkv_last_caller: lastOp.caller,
      mmkv_last_op: lastOp.op,
      mmkv_last_app_state: lastOp.appState,
      mmkv_last_runtime: lastOp.runtime,
      mmkv_diag_age_ms: String(ageMs),
    });
    crashlytics().log(
      `mmkv_handoff_last_op:${lastOp.caller}:${lastOp.op}:${lastOp.appState}:${lastOp.runtime}`,
    );
    logger.info('mmkv_handoff_last_op', {
      caller: lastOp.caller,
      op: lastOp.op,
      appState: lastOp.appState,
      runtime: lastOp.runtime,
      ageMs,
      keyHash: lastOp.keyHash,
    });
  } catch {
    // Recovery must never interrupt cold start.
  }
}
