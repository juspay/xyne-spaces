import os from 'node:os';
import Pyroscope from '@pyroscope/nodejs';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

if (config.pyroscope.enabled) {
  const { serverAddress, flushIntervalMs } = config.pyroscope;

  if (!serverAddress) {
    logger.warn('[pyroscope] PYROSCOPE_ENABLED=true but PYROSCOPE_SERVER_ADDRESS is not set; profiling disabled');
  } else {
    try {
      Pyroscope.init({
        serverAddress,
        appName: 'xyne-backend',
        tags: {
          pod: process.env.HOSTNAME || os.hostname(),
          env: config.env,
        },
        flushIntervalMs,
        wall: { collectCpuTime: true, samplingDurationMs: flushIntervalMs },
      });
      Pyroscope.start();
      logger.info(`[pyroscope] CPU and heap profiling started`);
    } catch (error) {
      logger.error('[pyroscope] failed to start profiling', { error });
    }
  }
}
