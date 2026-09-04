import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  resolve,
} from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import {
  EncryptionKeyRingConfigError,
  parseEncryptionKeyRing,
} from "@xyne/shared/server/encryption-key-ring";

export type SpacesEncryptionMode =
  | "legacy"
  | "keyring-read";

export type SpacesEncryptionModeReason =
  | "keyring_file_missing"
  | "keyring_file_unreadable"
  | "keyring_file_invalid"
  | "keyring_json_invalid"
  | "keyring_validation_failed"
  | "active_key_missing"
  | "keyring_read_enabled";

export interface SpacesEncryptionRuntimeConfig {
  mode: SpacesEncryptionMode;
  reason: SpacesEncryptionModeReason;
  keys: ReadonlyMap<string, Buffer>;
  diagnosticLogFile: string | null;
}

class SpacesKeyRingFileError extends Error {
  constructor(
    readonly reason: SpacesEncryptionModeReason,
    message: string,
  ) {
    super(message);
    this.name = "SpacesKeyRingFileError";
  }
}

const DEFAULT_FILE = fileURLToPath(
  new URL("../.env.keyring", import.meta.url),
);

const ALLOWED_VARIABLES = new Set([
  "SPACES_ENCRYPTION_KEYS",
  "SPACES_ENCRYPTION_DIAGNOSTIC_LOG_FILE",
]);

let cachedConfig:
  SpacesEncryptionRuntimeConfig | null = null;

function resolveKeyRingFile(): string {
  const configured =
    process.env["SPACES_ENCRYPTION_KEYRING_ENV_FILE"]
      ?.trim();

  if (!configured) {
    return DEFAULT_FILE;
  }

  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

function resolveDiagnosticFile(
  value: string | undefined,
  keyRingFile: string,
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
  event: Record<string, unknown>,
): void {
  try {
    mkdirSync(dirname(logFile), {
      recursive: true,
    });

    appendFileSync(
      logFile,
      `${JSON.stringify(event)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  } catch {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        service: "xyne-claw-auth",
        event:
          "spaces_encryption_diagnostic_write_failed",
      }),
    );
  }
}

export function writeSpacesEncryptionDiagnostic(
  config: SpacesEncryptionRuntimeConfig,
  event: {
    event: "decrypt";
    operation: string;
    format: "legacy" | "v2";
    keyId: string | null;
    success: boolean;
    durationMs: number;
    reasonCode?: string;
  },
): void {
  if (!config.diagnosticLogFile) {
    return;
  }

  appendDiagnosticLine(
    config.diagnosticLogFile,
    {
      timestamp: new Date().toISOString(),
      service: "xyne-claw-auth",
      ...event,
    },
  );
}

function writeModeDiagnostic(
  config: SpacesEncryptionRuntimeConfig,
  keyRingFilePresent: boolean,
): void {
  const event = {
    timestamp: new Date().toISOString(),
    service: "xyne-claw-auth",
    event: "spaces_encryption_mode_selected",
    mode: config.mode,
    reasonCode: config.reason,
    keyRingFilePresent,
  };

  const line = JSON.stringify(event);

  if (
    config.mode === "legacy" &&
    config.reason !== "keyring_file_missing"
  ) {
    console.warn(line);
  } else {
    console.info(line);
  }

  if (config.diagnosticLogFile) {
    appendDiagnosticLine(
      config.diagnosticLogFile,
      event,
    );
  }
}

function legacyConfig(
  reason: SpacesEncryptionModeReason,
  diagnosticLogFile: string | null,
  keyRingFilePresent: boolean,
): SpacesEncryptionRuntimeConfig {
  const config: SpacesEncryptionRuntimeConfig = {
    mode: "legacy",
    reason,
    keys: new Map(),
    diagnosticLogFile,
  };

  writeModeDiagnostic(
    config,
    keyRingFilePresent,
  );

  return config;
}

export function loadSpacesEncryptionRuntimeConfig():
  SpacesEncryptionRuntimeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const keyRingFile = resolveKeyRingFile();

  const processDiagnosticFile =
    resolveDiagnosticFile(
      process.env[
        "SPACES_ENCRYPTION_DIAGNOSTIC_LOG_FILE"
      ],
      keyRingFile,
    );

  if (!existsSync(keyRingFile)) {
    cachedConfig = legacyConfig(
      "keyring_file_missing",
      processDiagnosticFile,
      false,
    );

    return cachedConfig;
  }

  let contents: string;

  try {
    contents = readFileSync(
      keyRingFile,
      "utf8",
    );
  } catch {
    cachedConfig = legacyConfig(
      "keyring_file_unreadable",
      processDiagnosticFile,
      true,
    );

    return cachedConfig;
  }

  try {
    const parsedEnv = parseEnv(contents);

    const unknownVariables =
      Object.keys(parsedEnv).filter(
        (name) => !ALLOWED_VARIABLES.has(name),
      );

    if (unknownVariables.length > 0) {
      throw new SpacesKeyRingFileError(
        "keyring_file_invalid",
        "The key-ring file contains unsupported variables",
      );
    }

    const rawKeys =
      parsedEnv["SPACES_ENCRYPTION_KEYS"]
        ?.trim();

    if (!rawKeys) {
      throw new SpacesKeyRingFileError(
        "keyring_json_invalid",
        "SPACES_ENCRYPTION_KEYS is missing",
      );
    }

    const { keys } =
      parseEncryptionKeyRing(rawKeys);

    const diagnosticLogFile =
      resolveDiagnosticFile(
        parsedEnv[
          "SPACES_ENCRYPTION_DIAGNOSTIC_LOG_FILE"
        ] ??
          process.env[
            "SPACES_ENCRYPTION_DIAGNOSTIC_LOG_FILE"
          ],
        keyRingFile,
      );

    cachedConfig = {
      mode: "keyring-read",
      reason: "keyring_read_enabled",
      keys,
      diagnosticLogFile,
    };

    writeModeDiagnostic(cachedConfig, true);
    return cachedConfig;
  } catch (error) {
    const reason:
      SpacesEncryptionModeReason =
        error instanceof SpacesKeyRingFileError
          ? error.reason
          : error instanceof
              EncryptionKeyRingConfigError
            ? error.reason
            : "keyring_file_invalid";

    cachedConfig = legacyConfig(
      reason,
      processDiagnosticFile,
      true,
    );

    return cachedConfig;
  }
}

export function resetSpacesEncryptionRuntimeConfig():
  void {
  cachedConfig = null;
}
