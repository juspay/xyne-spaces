import type { AuditLookup, AuditRow } from './types';

/**
 * Per-save resolution context. Name lookups are warmed in bulk (async) then read
 * synchronously by the config's field/json formatters while diffs are computed.
 * All lookups are memoized, so repeated references across one save's mutations
 * cost a single query.
 */
export class AuditResolution {
  private readonly stageNameById = new Map<string, string>();
  private readonly stageBoardIdById = new Map<string, string>();
  private readonly transitionLabelById = new Map<string, string>();
  private readonly transitionBoardIdById = new Map<string, string>();
  private readonly boardNameById = new Map<string, string>();
  private readonly userNameById = new Map<string, string>();
  private readonly userExistsById = new Map<string, boolean>();
  private readonly roleNameById = new Map<string, string>();
  private readonly formNameById = new Map<string, string>();
  private readonly globalFieldNameById = new Map<string, string>();
  private readonly boardIdsByFormId = new Map<string, string[]>();

  constructor(private readonly lookup: AuditLookup) {}

  async warmStages(ids: Iterable<string>): Promise<void> {
    const missing = [...new Set(ids)].filter(id => !this.stageNameById.has(id));
    if (missing.length === 0) return;
    const stages = await this.lookup.stagesByIds(missing);
    for (const id of missing) {
      const stage = stages.find(candidate => candidate.id === id);
      this.stageNameById.set(id, stage?.name ?? id);
      this.stageBoardIdById.set(id, stage?.boardId ?? '');
    }
  }

  stageName(stageId: string | null | undefined): string {
    if (!stageId) return '';
    return this.stageNameById.get(stageId) ?? stageId;
  }

  stageBoardId(stageId: string | null | undefined): string | null {
    if (!stageId) return null;
    return this.stageBoardIdById.get(stageId) ?? null;
  }

  async resolveStageBoardId(stageId: string | null | undefined): Promise<string | null> {
    if (!stageId) return null;
    await this.warmStages([stageId]);
    return this.stageBoardId(stageId);
  }

  async warmTransitions(ids: Iterable<string>): Promise<void> {
    const missing = [...new Set(ids)].filter(id => !this.transitionLabelById.has(id));
    if (missing.length === 0) return;
    const transitions = await this.lookup.transitionsByIds(missing);
    const stageIds = transitions.flatMap(transition =>
      transition.fromStageId ? [transition.fromStageId, transition.toStageId] : [transition.toStageId],
    );
    await this.warmStages(stageIds);
    for (const id of missing) {
      const transition = transitions.find(candidate => candidate.id === id);
      this.transitionBoardIdById.set(id, transition?.boardId ?? '');
      this.transitionLabelById.set(id, transition ? this.transitionLabelFromRow(transition) : id);
    }
  }

  private transitionLabelFromRow(transition: {
    fromStageId: string | null;
    toStageId: string;
  }): string {
    const from = transition.fromStageId ? this.stageName(transition.fromStageId) : 'Any stage';
    return `${from} → ${this.stageName(transition.toStageId)}`;
  }

  transitionLabel(transitionId: string | null | undefined): string {
    if (!transitionId) return '';
    return this.transitionLabelById.get(transitionId) ?? transitionId;
  }

  async resolveTransitionLabel(transitionId: string): Promise<string> {
    await this.warmTransitions([transitionId]);
    return this.transitionLabel(transitionId);
  }

  async resolveTransitionBoardId(transitionId: string): Promise<string | null> {
    await this.warmTransitions([transitionId]);
    return this.transitionBoardIdById.get(transitionId) ?? null;
  }

  async warmBoards(ids: Iterable<string>): Promise<void> {
    const missing = [...new Set(ids)].filter(id => !this.boardNameById.has(id));
    if (missing.length === 0) return;
    const boards = await this.lookup.boardsByIds(missing);
    for (const id of missing) {
      const board = boards.find(candidate => candidate.id === id);
      this.boardNameById.set(id, board?.name ?? id);
    }
  }

  boardName(boardId: string | null | undefined): string {
    if (!boardId) return '';
    return this.boardNameById.get(boardId) ?? boardId;
  }

  async warmUsers(ids: Iterable<string>): Promise<void> {
    const missing = [...new Set(ids)].filter(id => !this.userNameById.has(id));
    if (missing.length === 0) return;
    const users = await this.lookup.usersByIds(missing);
    for (const id of missing) {
      const user = users.find(candidate => candidate.id === id);
      this.userExistsById.set(id, !!user);
      this.userNameById.set(id, user?.displayName || user?.name || id);
    }
  }

  userName(userId: string | null | undefined): string {
    if (!userId) return '';
    return this.userNameById.get(userId) ?? userId;
  }

  /**
   * The audit actor, or null when the id is not a users row (service/system
   * principals) — protects the audit_logs.actorUserId foreign key.
   */
  async resolveActorUserId(userId: string): Promise<string | null> {
    await this.warmUsers([userId]);
    return this.userExistsById.get(userId) === true ? userId : null;
  }

  /**
   * Mark the actor as unknown WITHOUT querying — used when the inside-transaction
   * prewarm failed, so the post-commit flush resolves actorUserId=null from this
   * cache entry instead of lazily querying the released connection.
   */
  markActorMissing(userId: string): void {
    this.userExistsById.set(userId, false);
    this.userNameById.set(userId, userId);
  }

  async warmRoles(ids: Iterable<string>): Promise<void> {
    const missing = [...new Set(ids)].filter(id => !this.roleNameById.has(id));
    if (missing.length === 0) return;
    const roles = await this.lookup.rolesByIds(missing);
    for (const id of missing) {
      const role = roles.find(candidate => candidate.id === id);
      this.roleNameById.set(id, role?.name ?? id);
    }
  }

  roleName(roleId: string | null | undefined): string {
    if (!roleId) return '';
    return this.roleNameById.get(roleId) ?? roleId;
  }

  async warmForms(ids: Iterable<string>): Promise<void> {
    const missing = [...new Set(ids)].filter(id => !this.formNameById.has(id));
    if (missing.length === 0) return;
    const forms = await this.lookup.formsByIds(missing);
    for (const id of missing) {
      const form = forms.find(candidate => candidate.id === id);
      this.formNameById.set(id, form?.formName ?? id);
    }
  }

  formName(formId: string | null | undefined): string {
    if (!formId) return '';
    return this.formNameById.get(formId) ?? formId;
  }

  async warmGlobalFields(ids: Iterable<string>): Promise<void> {
    const missing = [...new Set(ids)].filter(id => !this.globalFieldNameById.has(id));
    if (missing.length === 0) return;
    const fields = await this.lookup.globalFieldsByIds(missing);
    for (const id of missing) {
      const field = fields.find(candidate => candidate.id === id);
      this.globalFieldNameById.set(id, field?.fieldName ?? id);
    }
  }

  globalFieldName(globalFieldId: string | null | undefined): string {
    if (!globalFieldId) return '';
    return this.globalFieldNameById.get(globalFieldId) ?? globalFieldId;
  }

  async warmFormBoards(formIds: Iterable<string>): Promise<void> {
    const missing = [...new Set(formIds)].filter(id => !this.boardIdsByFormId.has(id));
    if (missing.length === 0) return;
    const bindings = await this.lookup.boardIdsForFormIds(missing);
    for (const id of missing) {
      const binding = bindings.find(candidate => candidate.formId === id);
      this.boardIdsByFormId.set(id, binding?.boardIds ?? []);
    }
  }

  boardIdsForForm(formId: string): string[] {
    return this.boardIdsByFormId.get(formId) ?? [];
  }

  /** Collect the role/form/stage ids referenced by the known board-metadata keys. */
  collectMetadataIds(metadata: unknown): { roleIds: string[]; formIds: string[]; stageIds: string[] } {
    const roleIds = new Set<string>();
    const formIds = new Set<string>();
    const stageIds = new Set<string>();
    const record = metadata as Record<string, unknown> | null | undefined;
    if (!record) return { roleIds: [], formIds: [], stageIds: [] };

    const pushIds = (ids: unknown, target: Set<string>): void => {
      if (Array.isArray(ids)) for (const id of ids) target.add(String(id));
    };

    pushIds(record.ticketControlRoleIds, roleIds);
    if (Array.isArray(record.assignmentRoles)) {
      for (const slot of record.assignmentRoles) {
        roleIds.add(String((slot as { roleId: string }).roleId));
      }
    }
    const bitbucketEventRoles = record.bitbucketEventRoles as
      | { prOpenedRoleId?: string; prMergedRoleId?: string }
      | undefined;
    if (bitbucketEventRoles?.prOpenedRoleId) roleIds.add(bitbucketEventRoles.prOpenedRoleId);
    if (bitbucketEventRoles?.prMergedRoleId) roleIds.add(bitbucketEventRoles.prMergedRoleId);
    if (typeof record.customFieldsFormId === 'string') formIds.add(record.customFieldsFormId);

    pushIds(record.standardPathStageIds, stageIds);
    const etaManagement = record.etaManagement as { standardPathStageIds?: string[] } | undefined;
    pushIds(etaManagement?.standardPathStageIds, stageIds);

    return { roleIds: [...roleIds], formIds: [...formIds], stageIds: [...stageIds] };
  }
}

/** Row accessor helpers shared by config resolvers. */
export const rowString = (row: AuditRow, field: string): string =>
  row[field] === null || row[field] === undefined ? '' : String(row[field]);
