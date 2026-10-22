import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';

import { logger as structuredLogger } from '../logging/appLogger';
import { appMetrics } from '../metrics/appMetrics';
import { createLotusInstrumentation } from './createLotusInstrumentation';

export const lotusInstrumentation = createLotusInstrumentation({
  structuredLogger,
  metrics: appMetrics,
  onChatOpenZeroRunComplete: fields => {
    chatOpenProfiler.mark('zero_run_complete', fields);
  },
});
