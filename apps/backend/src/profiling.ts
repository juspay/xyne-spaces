import os from 'node:os';
import Pyroscope from '@pyroscope/nodejs';
import { config } from '@/config/env';

// Continuous CPU + heap profiling sent to Grafana Pyroscope. Opt-in: does
// nothing unless PYROSCOPE_ENABLED=true and PYROSCOPE_SERVER_ADDRESS is set.
// Must be imported first in the entrypoint so profiling covers startup.
if (config.pyroscope.enabled) {
  const { serverAddress, flushIntervalMs } = config.pyroscope;

  if (!serverAddress) {
    console.warn('[pyroscope] PYROSCOPE_ENABLED=true but PYROSCOPE_SERVER_ADDRESS is not set; profiling disabled');
  } else {
    try {
      Pyroscope.init({
        serverAddress,
        appName: 'xyne-backend',
        tags: {
          // Pod name on Kubernetes; falls back to the machine hostname locally.
          pod: process.env.HOSTNAME || os.hostname(),
          env: config.env,
        },
        flushIntervalMs,
        wall: { collectCpuTime: true, samplingDurationMs: flushIntervalMs },
      });
      Pyroscope.start();
      console.info(`[pyroscope] CPU and heap profiling started -> ${serverAddress}`);
    } catch (error) {
      // Profiling must never take the backend down.
      console.error('[pyroscope] failed to start profiling', error);
    }
  }
}
