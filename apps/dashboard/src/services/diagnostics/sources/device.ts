import { detectPlatform } from '../../../hooks/usePlatform';
import { diagnosticsStore } from '../store';
import { readConnectionInfo } from './network';
import type { DeviceInfo } from '../types';

/**
 * Static context for the exported report. A number without the machine it came
 * from is not diagnosable — 400ms INP on an 8-core desktop and on a throttled
 * 2-core laptop are different findings.
 */
export function collectDeviceInfo(): DeviceInfo {
  return {
    platform: detectPlatform(),
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
    screen: `${window.screen.width}×${window.screen.height}`,
    dpr: window.devicePixelRatio,
    connection: readConnectionInfo(),
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
    appVersion: null,
    deviceId: readDeviceId(),
  };
}

export function startDeviceSource(): () => void {
  diagnosticsStore.setDevice(collectDeviceInfo());
  return () => undefined;
}

/**
 * Same id OTel uses as `service_instance_id`, so an exported report can be
 * joined to this device's server-side metrics.
 */
function readDeviceId(): string | null {
  try {
    return window.localStorage.getItem('otel_device_id');
  } catch {
    return null;
  }
}
