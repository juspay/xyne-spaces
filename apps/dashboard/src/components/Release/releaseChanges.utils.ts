/**
 * Shared utilities for computing release change data structures.
 * Used by ReleaseDetailScreen.
 */
import { type ChangeSectionsGroup, type RenderableFileGroup } from './ChangeCards';
import { extractEnvVarsFromBag } from './envVars';
import type { ReleaseStageOption } from './ReleaseStagePicker';
import type { TicketStatusV2, VCSProviderType } from '@xyne/shared';

// ─── Minimal input shapes (structural) ───────────────────────────────────────
// We use minimal structural types so callers don't need to import Zero generics.

export interface StageRowInput {
  boardId: string;
  name: string;
  defaultTicketStatusV2?: TicketStatusV2 | null;
}

/**
 * Group stage rows (queries.stagesByBoards) into per-board picker options.
 * Single source for the stage→status sync shape used by ReleaseStagePicker —
 * keeps ReleaseDetailScreen and ReleasesSection from drifting.
 */
export function buildStagesByBoard(
  stages: readonly StageRowInput[] | null | undefined,
): Map<string, ReleaseStageOption[]> {
  const map = new Map<string, ReleaseStageOption[]>();
  for (const s of stages ?? []) {
    const arr = map.get(s.boardId) ?? [];
    arr.push({ name: s.name, defaultTicketStatusV2: s.defaultTicketStatusV2 ?? null });
    map.set(s.boardId, arr);
  }
  return map;
}

export interface ChangeFormValueInput {
  entityId: string;
  fieldValue: string | null | undefined;
  actualFieldValue: unknown;
  formField?: { fieldName?: string | null } | null | undefined;
  globalField?: { fieldName?: string | null } | null | undefined;
}

export interface ReleaseChangeInput {
  id: string;
  changeType: string;
  filePath: string | null | undefined;
  createdAt: number | null | undefined;
  commitId: string | null | undefined;
  devTicketXyneId: string | null | undefined;
  applicationReleaseId: string | null | undefined;
  application?:
    | {
        name: string;
        repoUrl: string | null | undefined;
      }
    | null
    | undefined;
}

// ─── valuesByChangeId ─────────────────────────────────────────────────────────
/**
 * Flattens the EAV form-value rows into a simple per-entity field map.
 * entityId (release_change_types.id) → { fieldName → stringValue }
 */
export function buildValuesByChangeId(
  changeFormValues: ChangeFormValueInput[] | null | undefined,
): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  for (const fv of changeFormValues ?? []) {
    const fieldName = fv.globalField?.fieldName ?? fv.formField?.fieldName;
    if (!fieldName) continue;
    const bag = map.get(fv.entityId) ?? {};
    const raw = fv.actualFieldValue;
    bag[fieldName] =
      raw === null || raw === undefined
        ? (fv.fieldValue ?? '')
        : typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
          ? String(raw)
          : JSON.stringify(raw);
    map.set(fv.entityId, bag);
  }
  return map;
}

// ─── groupedByApp ─────────────────────────────────────────────────────────────
/**
 * Groups release changes into the `ChangeSectionsGroup[]` shape consumed by
 * `<ChangeSections>`. Each app section contains an array of per-file groups,
 * each file group carries every change row (oldest-first).
 *
 * Pass a pre-filtered array when you only want changes for a specific dev ticket.
 */
export function buildGroupedByApp(
  releaseChanges: ReleaseChangeInput[] | null | undefined,
  // repoUrl → stored vcsProvider, for the repo header badge.
  vcsProviderByRepoUrl?: Map<string, VCSProviderType | null>,
): ChangeSectionsGroup[] {
  const apps = new Map<
    string,
    {
      appName: string;
      repoUrl: string | null;
      vcsProvider: VCSProviderType | null;
      files: Map<string, RenderableFileGroup>;
      earliestAt: number;
    }
  >();

  for (const c of releaseChanges ?? []) {
    const appName = c.application?.name ?? '—';
    const repoUrl = c.application?.repoUrl ?? null;
    const groupKey = `${repoUrl ?? ''}|${appName}`;
    const filePath = c.filePath ?? '—';
    const fileKey = `${filePath}|${c.changeType}`;
    const createdAt = c.createdAt ?? 0;

    let app = apps.get(groupKey);
    if (!app) {
      app = {
        appName,
        repoUrl,
        vcsProvider: vcsProviderByRepoUrl?.get(repoUrl ?? '') ?? null,
        files: new Map(),
        earliestAt: createdAt,
      };
      apps.set(groupKey, app);
    } else {
      app.earliestAt = Math.min(app.earliestAt, createdAt);
    }

    let file = app.files.get(fileKey);
    if (!file) {
      file = {
        key: fileKey,
        changeType: c.changeType,
        filePath,
        changes: [],
        earliestAt: createdAt,
        devTicketXyneIds: new Set(),
        commitIds: new Set(),
      };
      app.files.set(fileKey, file);
    }
    file.earliestAt = Math.min(file.earliestAt, createdAt);
    file.changes.push({
      id: c.id,
      commitId: c.commitId ?? null,
      devTicketXyneId: c.devTicketXyneId ?? null,
      createdAt,
    });
    if (c.devTicketXyneId) file.devTicketXyneIds.add(c.devTicketXyneId);
    if (c.commitId) file.commitIds.add(c.commitId);
  }

  return Array.from(apps.values())
    .sort((a, b) => a.earliestAt - b.earliestAt)
    .map(a => ({
      appName: a.appName,
      repoUrl: a.repoUrl,
      vcsProvider: a.vcsProvider,
      files: Array.from(a.files.values())
        .map(f => ({ ...f, changes: [...f.changes].sort((x, y) => x.createdAt - y.createdAt) }))
        .sort((x, y) => x.earliestAt - y.earliestAt),
    }));
}

// ─── filterGroupsByKind ───────────────────────────────────────────────────────
/** Drops files of the wrong kind and apps that become empty as a result. */
export function filterGroupsByKind(
  groups: ChangeSectionsGroup[],
  kind: 'ENV' | 'MIGRATION',
): ChangeSectionsGroup[] {
  return groups
    .map(a => ({ ...a, files: a.files.filter(f => f.changeType === kind) }))
    .filter(a => a.files.length > 0);
}

// ─── Change count maps ────────────────────────────────────────────────────────
export type ChangeCounts = { env: number; mig: number };

/**
 * Builds a map of `key → { env, mig }` change counts.
 * `keyFn` selects the grouping key from each change row
 * (e.g. `c => c.applicationReleaseId` or `c => c.devTicketXyneId`).
 *
 * env: unique env var names (via extractEnvVarsFromBag — matches the canvas count)
 * mig: unique migration file paths
 */
export function buildChangeCountsByKey(
  releaseChanges: ReleaseChangeInput[] | null | undefined,
  valuesByChangeId: Map<string, Record<string, string>>,
  keyFn: (c: ReleaseChangeInput) => string | null | undefined,
): Map<string, ChangeCounts> {
  const raw = new Map<string, { env: Set<string>; migFiles: Set<string> }>();
  for (const c of releaseChanges ?? []) {
    const key = keyFn(c);
    if (!key) continue;
    const entry = raw.get(key) ?? { env: new Set<string>(), migFiles: new Set<string>() };
    if (c.changeType === 'ENV') {
      const bag = valuesByChangeId.get(c.id) ?? {};
      extractEnvVarsFromBag(bag).forEach(n => entry.env.add(n));
    } else if (c.changeType === 'MIGRATION') {
      entry.migFiles.add(c.filePath ?? '');
    }
    raw.set(key, entry);
  }
  const result = new Map<string, ChangeCounts>();
  for (const [key, { env, migFiles }] of raw) {
    result.set(key, { env: env.size, mig: migFiles.size });
  }
  return result;
}
