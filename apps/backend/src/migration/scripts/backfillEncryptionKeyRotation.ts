import { PrismaClient } from '@prisma/client';
import {
  rotateCiphertext,
  rotateEncryptedJsonStrings,
  type CiphertextRotationResult,
  type JsonRotationStats,
} from '../../services/encryptionRotation';
import { decrypt, encrypt, getActiveEncryptionKeyId } from '../../services/encryptionService';

interface Options {
  apply: boolean;
  batchSize: number;
  confirmedKeyId: string | null;
  targets: Set<string> | null;
  help: boolean;
  listTargets: boolean;
}

interface ScalarRow {
  id: string;
  value: string;
}

interface FailureSample {
  rowId: string;
  reason: string;
}

interface TargetStats {
  rowsScanned: number;
  valuesScanned: number;
  legacy: number;
  active: number;
  otherKey: number;
  malformed: number;
  failed: number;
  failureSamples: FailureSample[];
  wouldRotate: number;
  rotated: number;
  updated: number;
  casSkipped: number;
  updateFailed: number;
  updateFailureSamples: FailureSample[];
  invalidJson: number;
  blockedRows: number;
  byKeyId: Record<string, number>;
}

interface ScalarTarget {
  name: string;
  fetch: (afterId: string | null, batchSize: number) => Promise<ScalarRow[]>;
  update: (id: string, originalValue: string, rotatedValue: string) => Promise<number>;
}

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1000;
const MAX_FAILURE_SAMPLES = 5;
const WORKFLOW_TARGET = 'workflows.context';

const SCOPE_NOTICE =
  'Covers AES-256-CBC values written by encryptionService only; ' +
  'AES-256-GCM envelopes are out of scope, and successful completion ' +
  'does not authorize retirement of ENCRYPTION_KEY.';

const TARGET_NAMES = [
  'workflow-mappings.entitySecret',
  'org-llm-credentials.credentials',
  'user-external-tokens.encryptedToken',
  'user-external-tokens.refreshToken',
  'external-sources.credentials',
  'apps.signingSecret',
  'installed-apps.signingSecret',
  'incoming-webhooks.secret',
  'data-sources.credentials',
  WORKFLOW_TARGET,
] as const;

function writeStdout(...parts: unknown[]): void {
  process.stdout.write(parts.map(String).join(' ') + '\n');
}

function writeStderr(...parts: unknown[]): void {
  process.stderr.write(parts.map(String).join(' ') + '\n');
}

function getFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replace(/\s+/g, ' ').slice(0, 500);
}

function recordFailureSample(samples: FailureSample[], rowId: string, error: unknown): void {
  if (samples.length >= MAX_FAILURE_SAMPLES) {
    return;
  }

  samples.push({
    rowId,
    reason: getFailureReason(error),
  });
}

function printHelp(): void {
  writeStdout(`
Encryption key-rotation backfill

Scope:
  ${SCOPE_NOTICE}

Dry-run is the default:

  pnpm run encryption:backfill

Apply changes:

  pnpm run encryption:backfill -- \\
    --apply \\
    --confirm-active-key=<keyId>

Options:

  --apply
      Write re-encrypted values. Without this flag, no database rows change.

  --confirm-active-key=<keyId>
      Required with --apply. Must exactly match the final key ID in
      the ordered ENCRYPTION_KEYS array.

  --batch-size=<1-${MAX_BATCH_SIZE}>
      Number of rows fetched per batch. Default: ${DEFAULT_BATCH_SIZE}.

  --target=<target>
      Process one target. May be supplied more than once.

  --list-targets
      Print available target names.

  --help
      Print this help.
`);
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    apply: false,
    batchSize: DEFAULT_BATCH_SIZE,
    confirmedKeyId: null,
    targets: null,
    help: false,
    listTargets: false,
  };

  const selectedTargets = new Set<string>();

  for (const argument of argv) {
    // pnpm may forward its argument separator to the script.
    if (argument === '--') {
      continue;
    }

    if (argument === '--apply') {
      options.apply = true;
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--list-targets') {
      options.listTargets = true;
      continue;
    }

    if (argument.startsWith('--batch-size=')) {
      const raw = argument.slice('--batch-size='.length);
      const parsed = Number.parseInt(raw, 10);

      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
        throw new Error(`--batch-size must be between 1 and ${MAX_BATCH_SIZE}`);
      }

      options.batchSize = parsed;
      continue;
    }

    if (argument.startsWith('--confirm-active-key=')) {
      options.confirmedKeyId = argument.slice('--confirm-active-key='.length).trim();
      continue;
    }

    if (argument.startsWith('--target=')) {
      const target = argument.slice('--target='.length).trim();

      if (!target) {
        throw new Error('--target must not be empty');
      }

      selectedTargets.add(target);
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (selectedTargets.size > 0) {
    options.targets = selectedTargets;
  }

  return options;
}

function createStats(): TargetStats {
  return {
    rowsScanned: 0,
    valuesScanned: 0,
    legacy: 0,
    active: 0,
    otherKey: 0,
    malformed: 0,
    failed: 0,
    failureSamples: [],
    wouldRotate: 0,
    rotated: 0,
    updated: 0,
    casSkipped: 0,
    updateFailed: 0,
    updateFailureSamples: [],
    invalidJson: 0,
    blockedRows: 0,
    byKeyId: {},
  };
}

function incrementKey(stats: TargetStats, keyId: string, count = 1): void {
  stats.byKeyId[keyId] = (stats.byKeyId[keyId] ?? 0) + count;
}

function recordCiphertextResult(stats: TargetStats, result: CiphertextRotationResult): void {
  stats.valuesScanned += 1;

  switch (result.classification.kind) {
    case 'legacy':
      stats.legacy += 1;
      incrementKey(stats, result.classification.keyId);
      break;
    case 'active':
      stats.active += 1;
      incrementKey(stats, result.classification.keyId);
      break;
    case 'other-key':
      stats.otherKey += 1;
      incrementKey(stats, result.classification.keyId);
      break;
    case 'malformed':
      stats.malformed += 1;
      break;
  }

  switch (result.outcome) {
    case 'failed':
      stats.failed += 1;
      break;
    case 'would-rotate':
      stats.wouldRotate += 1;
      break;
    case 'rotated':
      stats.rotated += 1;
      break;
    default:
      break;
  }
}

function mergeJsonStats(target: TargetStats, source: JsonRotationStats): void {
  target.valuesScanned += source.encryptedValues;
  target.legacy += source.legacy;
  target.active += source.active;
  target.otherKey += source.otherKey;
  target.malformed += source.malformed;
  target.failed += source.failed;
  target.wouldRotate += source.wouldRotate;
  target.rotated += source.rotated;

  for (const [keyId, count] of Object.entries(source.byKeyId)) {
    incrementKey(target, keyId, count);
  }
}

function isSelected(name: string, selectedTargets: Set<string> | null): boolean {
  return selectedTargets === null || selectedTargets.has(name);
}

async function processScalarTarget(
  target: ScalarTarget,
  options: Options,
  activeKeyId: string
): Promise<TargetStats> {
  const stats = createStats();
  let afterId: string | null = null;

  for (;;) {
    const rows = await target.fetch(afterId, options.batchSize);

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      stats.rowsScanned += 1;

      const result = rotateCiphertext(row.value, activeKeyId, options.apply);

      if (result.outcome === 'failed' && result.error) {
        recordFailureSample(stats.failureSamples, row.id, result.error);
      }

      recordCiphertextResult(stats, result);

      if (options.apply && result.outcome === 'rotated') {
        try {
          const updated = await target.update(row.id, row.value, result.value);

          if (updated === 1) {
            stats.updated += 1;
          } else {
            stats.casSkipped += 1;
          }
        } catch (err) {
          stats.updateFailed += 1;
          recordFailureSample(stats.updateFailureSamples, row.id, err);
        }
      }
    }

    afterId = rows[rows.length - 1].id;

    if (rows.length < options.batchSize) {
      break;
    }
  }

  return stats;
}

async function processWorkflowContexts(
  prisma: PrismaClient,
  options: Options,
  activeKeyId: string
): Promise<TargetStats> {
  const stats = createStats();
  let afterId: string | null = null;

  for (;;) {
    const rows: Array<{ id: string; context: string | null }> = await prisma.workflow.findMany({
      where: {
        context: { contains: 'enc:' },
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: {
        id: true,
        context: true,
      },
      orderBy: { id: 'asc' },
      take: options.batchSize,
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      stats.rowsScanned += 1;

      if (!row.context) {
        continue;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(row.context);
      } catch {
        stats.invalidJson += 1;
        continue;
      }

      const result = rotateEncryptedJsonStrings(parsed, activeKeyId, options.apply);

      for (const reason of result.stats.failureSamples) {
        recordFailureSample(stats.failureSamples, row.id, reason);
      }

      mergeJsonStats(stats, result.stats);

      if (!options.apply || !result.changed) {
        continue;
      }

      if (result.stats.failed > 0 || result.stats.malformed > 0) {
        stats.blockedRows += 1;
        continue;
      }

      const rotatedContext = JSON.stringify(result.value);

      try {
        const update = await prisma.workflow.updateMany({
          where: {
            id: row.id,
            context: row.context,
          },
          data: {
            context: rotatedContext,
          },
        });

        if (update.count === 1) {
          stats.updated += 1;
        } else {
          stats.casSkipped += 1;
        }
      } catch (err) {
        stats.updateFailed += 1;
        recordFailureSample(stats.updateFailureSamples, row.id, err);
      }
    }

    afterId = rows[rows.length - 1].id;

    if (rows.length < options.batchSize) {
      break;
    }
  }

  return stats;
}

function buildScalarTargets(prisma: PrismaClient): ScalarTarget[] {
  return [
    {
      name: 'workflow-mappings.entitySecret',
      fetch: async (afterId, batchSize) => {
        const rows = await prisma.workflowMapping.findMany({
          where: afterId ? { id: { gt: afterId } } : undefined,
          select: { id: true, entitySecret: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        return rows.map((row) => ({
          id: row.id,
          value: row.entitySecret,
        }));
      },
      update: async (id, originalValue, rotatedValue) => {
        const result = await prisma.workflowMapping.updateMany({
          where: { id, entitySecret: originalValue },
          data: { entitySecret: rotatedValue },
        });

        return result.count;
      },
    },
    {
      name: 'org-llm-credentials.credentials',
      fetch: async (afterId, batchSize) => {
        const rows = await prisma.orgLLMServiceAccountCredential.findMany({
          where: afterId ? { id: { gt: afterId } } : undefined,
          select: { id: true, credentials: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        return rows.map((row) => ({
          id: row.id,
          value: row.credentials,
        }));
      },
      update: async (id, originalValue, rotatedValue) => {
        const result = await prisma.orgLLMServiceAccountCredential.updateMany({
          where: { id, credentials: originalValue },
          data: { credentials: rotatedValue },
        });

        return result.count;
      },
    },
    {
      name: 'user-external-tokens.encryptedToken',
      fetch: async (afterId, batchSize) => {
        const rows = await prisma.userExternalToken.findMany({
          where: afterId ? { id: { gt: afterId } } : undefined,
          select: { id: true, encryptedToken: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        return rows.map((row) => ({
          id: row.id,
          value: row.encryptedToken,
        }));
      },
      update: async (id, originalValue, rotatedValue) => {
        const result = await prisma.userExternalToken.updateMany({
          where: { id, encryptedToken: originalValue },
          data: { encryptedToken: rotatedValue },
        });

        return result.count;
      },
    },
    {
      name: 'user-external-tokens.refreshToken',
      fetch: async (afterId, batchSize) => {
        const rows = await prisma.userExternalToken.findMany({
          where: {
            refreshToken: { not: null },
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          select: { id: true, refreshToken: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        return rows.map((row) => ({
          id: row.id,
          value: row.refreshToken!,
        }));
      },
      update: async (id, originalValue, rotatedValue) => {
        const result = await prisma.userExternalToken.updateMany({
          where: { id, refreshToken: originalValue },
          data: { refreshToken: rotatedValue },
        });

        return result.count;
      },
    },
    {
      name: 'external-sources.credentials',
      fetch: async (afterId, batchSize) => {
        const rows = await prisma.externalSource.findMany({
          where: afterId ? { id: { gt: afterId } } : undefined,
          select: { id: true, credentials: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        return rows.map((row) => ({
          id: row.id,
          value: row.credentials,
        }));
      },
      update: async (id, originalValue, rotatedValue) => {
        const result = await prisma.externalSource.updateMany({
          where: { id, credentials: originalValue },
          data: { credentials: rotatedValue },
        });

        return result.count;
      },
    },
    {
      name: 'apps.signingSecret',
      fetch: async (afterId, batchSize) => {
        const rows = await prisma.apps.findMany({
          where: afterId ? { id: { gt: afterId } } : undefined,
          select: { id: true, signingSecret: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        return rows.map((row) => ({
          id: row.id,
          value: row.signingSecret,
        }));
      },
      update: async (id, originalValue, rotatedValue) => {
        const result = await prisma.apps.updateMany({
          where: { id, signingSecret: originalValue },
          data: { signingSecret: rotatedValue },
        });

        return result.count;
      },
    },
    {
      name: 'installed-apps.signingSecret',
      fetch: async (afterId, batchSize) => {
        const rows = await prisma.installedApps.findMany({
          where: {
            signingSecret: { not: null },
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          select: { id: true, signingSecret: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        return rows.map((row) => ({
          id: row.id,
          value: row.signingSecret!,
        }));
      },
      update: async (id, originalValue, rotatedValue) => {
        const result = await prisma.installedApps.updateMany({
          where: { id, signingSecret: originalValue },
          data: { signingSecret: rotatedValue },
        });

        return result.count;
      },
    },
    {
      name: 'incoming-webhooks.secret',
      fetch: async (afterId, batchSize) => {
        const rows = await prisma.appIncomingWebhook.findMany({
          where: afterId ? { id: { gt: afterId } } : undefined,
          select: { id: true, secret: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        return rows.map((row) => ({
          id: row.id,
          value: row.secret,
        }));
      },
      update: async (id, originalValue, rotatedValue) => {
        const result = await prisma.appIncomingWebhook.updateMany({
          where: { id, secret: originalValue },
          data: { secret: rotatedValue },
        });

        return result.count;
      },
    },
    {
      name: 'data-sources.credentials',
      fetch: async (afterId, batchSize) => {
        const rows = await prisma.dataSource.findMany({
          where: afterId ? { id: { gt: afterId } } : undefined,
          select: { id: true, credentials: true },
          orderBy: { id: 'asc' },
          take: batchSize,
        });

        return rows.map((row) => ({
          id: row.id,
          value: row.credentials,
        }));
      },
      update: async (id, originalValue, rotatedValue) => {
        const result = await prisma.dataSource.updateMany({
          where: { id, credentials: originalValue },
          data: { credentials: rotatedValue },
        });

        return result.count;
      },
    },
  ];
}

function validateTargetSelection(selectedTargets: Set<string> | null): void {
  if (!selectedTargets) {
    return;
  }

  const validTargets = new Set<string>(TARGET_NAMES);

  for (const target of selectedTargets) {
    if (!validTargets.has(target)) {
      throw new Error(`Unknown target "${target}". Use --list-targets to see valid targets.`);
    }
  }
}

function validateEncryptionConfiguration(options: Options): string {
  const activeKeyId = getActiveEncryptionKeyId();

  if (!activeKeyId) {
    throw new Error('ENCRYPTION_KEYS must contain at least one key before running the backfill');
  }

  if (options.apply && options.confirmedKeyId !== activeKeyId) {
    throw new Error(`--apply requires --confirm-active-key=${activeKeyId}`);
  }

  const probePlaintext = 'encryption-rotation-preflight';
  const probeCiphertext = encrypt(probePlaintext);

  if (!probeCiphertext.startsWith(`v2:${activeKeyId}:`)) {
    throw new Error('Encryption preflight did not use the final key in ENCRYPTION_KEYS');
  }

  if (decrypt(probeCiphertext) !== probePlaintext) {
    throw new Error('Encryption preflight round-trip failed');
  }

  return activeKeyId;
}

function hasBlockingProblems(stats: TargetStats): boolean {
  return (
    stats.malformed > 0 ||
    stats.failed > 0 ||
    stats.updateFailed > 0 ||
    stats.invalidJson > 0 ||
    stats.blockedRows > 0 ||
    stats.casSkipped > 0
  );
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.listTargets) {
    writeStdout(TARGET_NAMES.join('\n'));
    return;
  }

  validateTargetSelection(options.targets);

  const activeKeyId = validateEncryptionConfiguration(options);
  const prisma = new PrismaClient();

  const summaries: Record<string, TargetStats> = {};

  try {
    writeStdout(
      JSON.stringify(
        {
          event: 'encryption_backfill_started',
          scope: SCOPE_NOTICE,
          mode: options.apply ? 'apply' : 'dry-run',
          activeKeyId,
          batchSize: options.batchSize,
          targets: options.targets === null ? [...TARGET_NAMES] : [...options.targets],
        },
        null,
        2
      )
    );

    for (const target of buildScalarTargets(prisma)) {
      if (!isSelected(target.name, options.targets)) {
        continue;
      }

      summaries[target.name] = await processScalarTarget(target, options, activeKeyId);
    }

    if (isSelected(WORKFLOW_TARGET, options.targets)) {
      summaries[WORKFLOW_TARGET] = await processWorkflowContexts(prisma, options, activeKeyId);
    }
  } finally {
    await prisma.$disconnect();
  }

  const blocked = Object.values(summaries).some(hasBlockingProblems);

  writeStdout(
    JSON.stringify(
      {
        event: 'encryption_backfill_completed',
        scope: SCOPE_NOTICE,
        legacyKeyRetirementAuthorized: false,
        mode: options.apply ? 'apply' : 'dry-run',
        activeKeyId,
        blocked,
        summaries,
      },
      null,
      2
    )
  );

  if (blocked) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  writeStderr(
    'Encryption backfill failed:',
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
});
