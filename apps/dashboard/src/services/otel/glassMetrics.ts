import { metrics } from '@opentelemetry/api';
import type { Attributes, Counter, Meter, ObservableGauge } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';
import { isStandaloneWindow } from '../../utils/electronApp';
import { safeRecordMetric } from './index';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME);
}

const UNKNOWN = 'unknown';
const TOGGLE_COUNT_KEY = 'glass_toggle_count';
const MAX_TRACKED_ATTEMPT = 4;

interface GlassSnapshot {
  enabled: boolean;
  tier: string;
  os: string;
  osReleaseBand: string;
}

let _snapshot: GlassSnapshot | null = null;
let _registered = false;
let _glassEffectEnabled: ObservableGauge | null = null;
let _glassToggleTotal: Counter | null = null;

export const glassToggleTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_glassToggleTotal) {
      _glassToggleTotal = getMeter().createCounter('glass_toggle_total', {
        description:
          'Glass effect toggles from Preferences, by direction, tier and per-device attempt ordinal',
        unit: '1',
      });
    }
    return _glassToggleTotal[prop as keyof Counter];
  },
});

function gaugeAttributes(snapshot: GlassSnapshot): Attributes {
  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Prometheus metric label
    glass_tier: snapshot.tier,
    os: snapshot.os,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Prometheus metric label
    os_release_band: snapshot.osReleaseBand,
  };
}

function readSnapshot(): Promise<void> {
  const api = window.electronAPI?.glass;
  if (!api) {
    return Promise.resolve();
  }
  // `glass:get-settings` is window-global; `glass:is-active` is per-window and would make
  // pop-outs (same localStorage device id, same `instance` series) fight the main window.
  return api
    .getSettings()
    .then(settings => {
      _snapshot = {
        enabled: settings.enabled === true,
        tier: settings.tier ?? UNKNOWN,
        os: window.electronAPI?.platform ?? UNKNOWN,
        osReleaseBand: settings.osReleaseBand ?? UNKNOWN,
      };
    })
    .catch(() => undefined);
}

export function registerGlassStateGauge(): void {
  if (_registered || isStandaloneWindow()) {
    return;
  }

  const api = window.electronAPI?.glass;
  if (!api) {
    return;
  }
  _registered = true;

  if (!_glassEffectEnabled) {
    _glassEffectEnabled = getMeter().createObservableGauge('glass_effect_enabled', {
      description:
        'Native glass effect state per desktop device: 1 on, 0 off. Counts devices, not users, and only devices currently running the app',
    });
  }

  _glassEffectEnabled.addCallback(observer => {
    try {
      if (!_snapshot) {
        return;
      }
      observer.observe(_snapshot.enabled ? 1 : 0, gaugeAttributes(_snapshot));
    } catch (error) {
      console.error('[OTel] glass_effect_enabled observation failed:', error);
    }
  });

  void readSnapshot();
  api.onActiveChanged(() => {
    void readSnapshot();
  });
}

function nextToggleAttempt(): string {
  try {
    const previous = Number(window.localStorage.getItem(TOGGLE_COUNT_KEY) ?? '0');
    const attempt = Number.isFinite(previous) && previous > 0 ? previous + 1 : 1;
    window.localStorage.setItem(TOGGLE_COUNT_KEY, String(attempt));
    return attempt >= MAX_TRACKED_ATTEMPT ? `${MAX_TRACKED_ATTEMPT}+` : String(attempt);
  } catch {
    return UNKNOWN;
  }
}

export function trackGlassToggled(enabled: boolean, tier?: string): void {
  safeRecordMetric(() => {
    glassToggleTotal.add(1, {
      action: enabled ? 'turned_on' : 'turned_off',
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Prometheus metric label
      glass_tier: tier ?? _snapshot?.tier ?? UNKNOWN,
      attempt: nextToggleAttempt(),
    });
  });
}
