import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import { getEncryptionDiagnosticContext } from './encryptionDiagnosticContext.js';
import {
  EncryptionKeyRingConfigError,
  parseEncryptionKeyRing,
} from '@xyne/shared/server/encryption-key-ring';

export type EncryptionMode =
  | 'legacy'
  | 'keyring-read'
  | 'keyring-write';

export type EncryptionModeReason =
  | 'keyring_file_missing'
  | 'keyring_file_unreadable'
  | 'keyring_file_invalid'
  | 'keyring_json_invalid'
  | 'keyring_validation_failed'
  | 'active_key_missing'
  | 'keyring_preload_enabled'
  | 'keyring_write_enabled';

export interface EncryptionRuntimeConfig {
  mode: EncryptionMode;
  reason: EncryptionModeReason;
  keys: ReadonlyMap<string, Buffer>;
  activeKeyId: string | null;
  diagnosticLogFile: string | null;
}

class KeyRingConfigError extends Error {
  constructor(
    readonly reason: EncryptionModeReason,
    message: string
  ) {
    super(message);
  }
}

const DEFAULT_FILE = fileURLToPath(
  new URL('../../.env.keyring', import.meta.url)
);

const ALLOWED_VARIABLES = new Set([
  'ENCRYPTION_KEYS',
  'ENCRYPTION_ACTIVE_KEY_ID',
  'ENCRYPTION_DIAGNOSTIC_LOG_FILE',
]);

let cachedConfig: EncryptionRuntimeConfig | null = null;

function resolveKeyRingFile(): string {
  const configured =
    process.env.ENCRYPTION_KEYRING_ENV_FILE?.trim();

  if (!configured) {
    return DEFAULT_FILE;
  }

  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

function resolveDiagnosticFile(
  value: string | undefined,
  keyRingFile: string
): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return isAbsolute(normalized)
    ? normalized
    : resolve(dirname(keyRingFile), normalized);
}

function appendDiagnosticLine(
  logFile: string,
  event: Record<string, unknown>
): void {
  try {
    mkdirSync(dirname(logFile), {
      recursive: true,
    });

    appendFileSync(
      logFile,
      `${JSON.stringify(event)}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
      }
    );
  } catch {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'xyne-spaces-backend',
        event: 'encryption_diagnostic_write_failed',
      })
    );
  }
}

export function writeEncryptionOperationDiagnostic(
  config: EncryptionRuntimeConfig,
  event: {
    event: 'encrypt' | 'decrypt';
    format: 'legacy' | 'v2';
    keyId: string | null;
    success: boolean;
    durationMs: number;
    reasonCode?: string;
  }
): void {
  if (!config.diagnosticLogFile) {
    return;
  }

  const requestContext =
    getEncryptionDiagnosticContext();

  appendDiagnosticLine(
    config.diagnosticLogFile,
    {
      timestamp: new Date().toISOString(),
      service: 'xyne-spaces-backend',
      source: requestContext
        ? requestContext.source
        : 'background',
      requestId:
        requestContext?.requestId ?? null,
      method:
        requestContext?.method ?? null,
      routeTemplate:
        requestContext?.routeTemplate ?? null,
      ...event,
    }
  );
}

function writeModeDiagnostic(
  config: EncryptionRuntimeConfig,
  keyRingFilePresent: boolean
): void {
  const event = {
    timestamp: new Date().toISOString(),
    service: 'xyne-spaces-backend',
    event: 'encryption_mode_selected',
    mode: config.mode,
    reasonCode: config.reason,
    keyRingFilePresent,
    activeKeyId: config.activeKeyId,
  };

  const line = JSON.stringify(event);

  if (
    config.mode === 'legacy' &&
    config.reason !== 'keyring_file_missing'
  ) {
    console.warn(line);
  } else {
    console.info(line);
  }

  if (config.diagnosticLogFile) {
    appendDiagnosticLine(
      config.diagnosticLogFile,
      event
    );
  }
}

function legacyConfig(
  reason: EncryptionModeReason,
  diagnosticLogFile: string | null,
  keyRingFilePresent: boolean
): EncryptionRuntimeConfig {
  const config: EncryptionRuntimeConfig = {
    mode: 'legacy',
    reason,
    keys: new Map(),
    activeKeyId: null,
    diagnosticLogFile,
  };

  writeModeDiagnostic(config, keyRingFilePresent);
  return config;
}

export function loadEncryptionRuntimeConfig():
  EncryptionRuntimeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const keyRingFile = resolveKeyRingFile();
  const processDiagnosticFile =
    resolveDiagnosticFile(
      process.env.ENCRYPTION_DIAGNOSTIC_LOG_FILE,
      keyRingFile
    );

  if (!existsSync(keyRingFile)) {
    cachedConfig = legacyConfig(
      'keyring_file_missing',
      processDiagnosticFile,
      false
    );

    return cachedConfig;
  }

  let contents: string;

  try {
    contents = readFileSync(keyRingFile, 'utf8');
  } catch {
    cachedConfig = legacyConfig(
      'keyring_file_unreadable',
      processDiagnosticFile,
      true
    );

    return cachedConfig;
  }

  try {
    const parsedEnv = parseDotenv(contents);

    const unknownVariables =
      Object.keys(parsedEnv).filter(
        (name) => !ALLOWED_VARIABLES.has(name)
      );

    if (unknownVariables.length > 0) {
      throw new KeyRingConfigError(
        'keyring_file_invalid',
        'The key-ring file contains unsupported variables'
      );
    }

    const rawKeys = parsedEnv.ENCRYPTION_KEYS?.trim();

    if (!rawKeys) {
      throw new KeyRingConfigError(
        'keyring_json_invalid',
        'ENCRYPTION_KEYS is missing'
      );
    }

    const {
      keys,
      activeKeyId,
    } = parseEncryptionKeyRing(
      rawKeys,
      parsedEnv.ENCRYPTION_ACTIVE_KEY_ID
    );

    const diagnosticLogFile =
      resolveDiagnosticFile(
        parsedEnv.ENCRYPTION_DIAGNOSTIC_LOG_FILE ??
          process.env.ENCRYPTION_DIAGNOSTIC_LOG_FILE,
        keyRingFile
      );

    cachedConfig = {
      mode: activeKeyId
        ? 'keyring-write'
        : 'keyring-read',
      reason: activeKeyId
        ? 'keyring_write_enabled'
        : 'keyring_preload_enabled',
      keys,
      activeKeyId,
      diagnosticLogFile,
    };

    writeModeDiagnostic(cachedConfig, true);
    return cachedConfig;
  } catch (error) {
    const reason =
      error instanceof KeyRingConfigError
        ? error.reason
        : error instanceof EncryptionKeyRingConfigError
          ? error.reason
          : 'keyring_file_invalid';

    cachedConfig = legacyConfig(
      reason,
      processDiagnosticFile,
      true
    );

    return cachedConfig;
  }
}

export function resetEncryptionRuntimeConfig(): void {
  cachedConfig = null;
}
