import DeviceInfo from 'react-native-device-info';
import { Linking, Platform } from 'react-native';
import { getJson, setJson, lotusStorage } from '@/src/services/localStorage';
import { UPDATE_PROMPT_DISMISS_KEY, UPDATE_PROMPT_SNOOZE_MS } from './constants';
import type {
  AppVersionInfo,
  DismissRecord,
  PlatformUpdateConfig,
  UpdatePromptDecision,
} from './types';

/** Opens TestFlight on iOS when installed; otherwise the TestFlight App Store page. Android uses `storeUrl`. */
const TESTFLIGHT_SCHEME = 'itms-beta://';
const TESTFLIGHT_APP_STORE_URL = 'https://apps.apple.com/app/testflight/id899247664';

// ─── Version compare ────────────────────────────────────────────────────────

function parseVersionParts(version: string): number[] {
  return version
    .split('.')
    .map(part => Number.parseInt(part, 10))
    .map(n => (Number.isFinite(n) ? n : 0));
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const av = parseVersionParts(a);
  const bv = parseVersionParts(b);
  const len = Math.max(av.length, bv.length);

  for (let i = 0; i < len; i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function isRemoteNewer(
  local: AppVersionInfo,
  remote: Pick<PlatformUpdateConfig, 'latestVersion' | 'latestBuildNumber'>,
): boolean {
  const semverCmp = compareSemver(local.version, remote.latestVersion);
  if (semverCmp < 0) return true;
  if (semverCmp > 0) return false;
  return local.buildNumber < remote.latestBuildNumber;
}

export function isBelowMinSupported(local: AppVersionInfo, minSupportedVersion: string): boolean {
  return compareSemver(local.version, minSupportedVersion) < 0;
}

export function getLocalAppVersionInfo(): AppVersionInfo {
  return {
    version: DeviceInfo.getVersion(),
    buildNumber: Number.parseInt(DeviceInfo.getBuildNumber(), 10) || 0,
  };
}

// ─── Update prompt evaluation ───────────────────────────────────────────────

export function evaluateUpdatePrompt(
  platformConfig: PlatformUpdateConfig | undefined,
  local: AppVersionInfo,
): UpdatePromptDecision {
  if (!platformConfig?.enabled) return { kind: 'none' };
  if (!platformConfig.latestVersion) return { kind: 'none' };
  // iOS opens TestFlight in code; Android still needs a Play Store URL from config.
  if (Platform.OS !== 'ios' && !platformConfig.storeUrl) {
    return { kind: 'none' };
  }

  const outdated = isRemoteNewer(local, platformConfig);
  const unsupported = isBelowMinSupported(local, platformConfig.minSupportedVersion);

  if (!outdated && !unsupported) return { kind: 'none' };

  if (unsupported || platformConfig.mode === 'force') {
    return { kind: 'force', config: platformConfig };
  }

  return { kind: 'optional', config: platformConfig };
}

// ─── Optional-prompt dismiss / snooze (MMKV) ────────────────────────────────

function isDismissRecord(value: unknown): value is DismissRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<DismissRecord>;
  return (
    typeof record.targetVersion === 'string' &&
    typeof record.targetBuildNumber === 'number' &&
    Number.isFinite(record.targetBuildNumber) &&
    typeof record.dismissedAt === 'number' &&
    Number.isFinite(record.dismissedAt)
  );
}

export function readDismissRecord(): DismissRecord | null {
  const raw = getJson<unknown>(UPDATE_PROMPT_DISMISS_KEY);
  if (!isDismissRecord(raw)) {
    if (raw !== null) {
      lotusStorage.remove(UPDATE_PROMPT_DISMISS_KEY);
    }
    return null;
  }
  return raw;
}

export function writeDismissRecord(record: DismissRecord): void {
  setJson(UPDATE_PROMPT_DISMISS_KEY, record);
}

export function clearDismissRecord(): void {
  lotusStorage.remove(UPDATE_PROMPT_DISMISS_KEY);
}

export function shouldShowUpdatePrompt(
  record: DismissRecord | null | undefined,
  target: { latestVersion: string; latestBuildNumber: number },
  now = Date.now(),
): boolean {
  if (!record) return true;

  const sameTarget =
    record.targetVersion === target.latestVersion &&
    record.targetBuildNumber === target.latestBuildNumber;

  if (!sameTarget) return true;
  return now - record.dismissedAt >= UPDATE_PROMPT_SNOOZE_MS;
}

/**
 * Open the store / update destination for "Update now".
 * iOS: TestFlight app (no config storeUrl). Android: Play Store `storeUrl`.
 */
export async function openUpdateDestination(storeUrl?: string): Promise<void> {
  if (Platform.OS === 'ios') {
    try {
      if (await Linking.canOpenURL(TESTFLIGHT_SCHEME)) {
        await Linking.openURL(TESTFLIGHT_SCHEME);
        return;
      }
    } catch {
      // fall through to TestFlight App Store page
    }
    await Linking.openURL(TESTFLIGHT_APP_STORE_URL).catch(() => undefined);
    return;
  }

  if (!storeUrl) return;
  await Linking.openURL(storeUrl).catch(() => undefined);
}
