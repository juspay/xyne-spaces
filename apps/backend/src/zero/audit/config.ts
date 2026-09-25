import {
  AuditEntityType,
  deserializeFlowPlan,
  stringifyAuditValue,
} from '@xyne/shared';
import type { AuditResolution } from './resolution';
import { rowString } from './resolution';
import type { AuditRow, AuditScope, AuditTableConfig } from './types';

/**
 * The audit whitelist. A table appears here = every write to it (from any Zero
 * mutator or Prisma path) is diffed and recorded against the scope its config
 * resolves. Adding a new audit scope is a config entry, not mutator code.
 */

const boardScope = (row: AuditRow): AuditScope => ({
  entityType: AuditEntityType.BOARD,
  entityId: rowString(row, 'boardId') || rowString(row, 'id') || rowString(row, 'contextId'),
});

const assignmentScope = (row: AuditRow): AuditScope => ({
  entityType: AuditEntityType.USER_GROUP_ASSIGNMENT_CONFIG,
  entityId: rowString(row, 'userGroupId') || rowString(row, 'id'),
});

/** Cap on stored audit values — keeps the feed readable; full text stays in the row via tooltip. */
const MAX_AUDIT_VALUE_LENGTH = 100;

const truncateAuditValue = (value: string): string =>
  value.length > MAX_AUDIT_VALUE_LENGTH ? `${value.slice(0, MAX_AUDIT_VALUE_LENGTH)}…` : value;

/** Compact fallback for structural config the formatter doesn't know. */
const compactJson = (value: unknown): string | null => {
  const stringified = stringifyAuditValue(value);
  return stringified === null ? null : truncateAuditValue(stringified);
};

const formatTicketFormConfig = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const fields = value as Record<string, { enabled?: boolean; mandatory?: boolean }>;
  const parts = Object.entries(fields).map(([field, config]) => {
    if (!config || typeof config !== 'object') return `${field}: ${String(config)}`;
    const state = config.enabled ? 'on' : 'off';
    return config.mandatory ? `${field}: ${state} (required)` : `${field}: ${state}`;
  });
  return parts.length > 0 ? parts.join(', ') : null;
};

/** boards.metadata sub-key formatter — resolves role/form/stage ids into names. */
const formatBoardMetadataValue = (
  key: string,
  value: unknown,
  res: AuditResolution,
): string | null => {
  switch (key) {
    case 'ticketControlRoleIds':
      return formatIdList(value, id => res.roleName(id));
    case 'assignmentRoles': {
      if (!Array.isArray(value) || value.length === 0) return null;
      return value
        .map(slot => {
          const roleId = String((slot as { roleId: string }).roleId);
          return `${res.roleName(roleId)}${(slot as { isPrimary?: boolean }).isPrimary ? ' (primary)' : ''}`;
        })
        .join(', ');
    }
    case 'bitbucketEventRoles': {
      if (value === null || value === undefined) return null;
      const roles = value as { prOpenedRoleId?: string; prMergedRoleId?: string };
      const parts: string[] = [];
      if (roles.prOpenedRoleId) parts.push(`PR opened: ${res.roleName(roles.prOpenedRoleId)}`);
      if (roles.prMergedRoleId) parts.push(`PR merged: ${res.roleName(roles.prMergedRoleId)}`);
      return parts.length > 0 ? parts.join('; ') : null;
    }
    case 'customFieldsFormId':
      return value === null || value === undefined ? null : res.formName(String(value));
    case 'standardPathStageIds':
      return formatIdList(value, id => res.stageName(id), ' → ');
    case 'etaManagement': {
      if (value === null || value === undefined) return null;
      const etaManagement = value as {
        autoRecomputeEnabled?: boolean;
        standardPathStageIds?: string[];
      };
      const parts: string[] = [];
      if (etaManagement.autoRecomputeEnabled !== undefined) {
        parts.push(`auto ETA: ${etaManagement.autoRecomputeEnabled ? 'on' : 'off'}`);
      }
      if (etaManagement.standardPathStageIds !== undefined) {
        const path = formatIdList(etaManagement.standardPathStageIds, id => res.stageName(id), ' → ');
        parts.push(`standard path: ${path ?? 'none'}`);
      }
      return parts.length > 0 ? parts.join('; ') : null;
    }
    case 'ticketFormConfig':
      return formatTicketFormConfig(value);
    case 'fieldOrder':
      return Array.isArray(value) ? `${value.length} fields` : null;
    case 'customFieldVisibility': {
      if (value === null || value === undefined) return null;
      const visibility = value as Record<string, boolean>;
      const entries = Object.values(visibility);
      if (entries.length === 0) return null;
      const visible = entries.filter(Boolean).length;
      return `${visible} visible, ${entries.length - visible} hidden`;
    }
    case 'devTicketColumns':
      return formatIdList(value, id => id);
    default:
      return compactJson(value);
  }
};

const formatIdList = (
  ids: unknown,
  resolveName: (id: string) => string,
  separator = ', ',
): string | null => {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return ids.map(id => resolveName(String(id))).join(separator);
};

const formatFlowPlan = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  try {
    const plan = deserializeFlowPlan(String(value));
    return `${plan.nodes.length} nodes, ${plan.groups?.length ?? 0} groups, ${plan.decisions?.length ?? 0} decisions`;
  } catch {
    return 'updated';
  }
};

const transitionLabel = (row: AuditRow, res: AuditResolution): string => {
  const from = row.fromStageId ? res.stageName(String(row.fromStageId)) : 'Any stage';
  return `${from} → ${res.stageName(String(row.toStageId))}`;
};

const approverLabel = (row: AuditRow, res: AuditResolution): string | null => {
  if (row.roleId) return res.roleName(String(row.roleId));
  if (row.userId) return res.userName(String(row.userId));
  return null;
};

export const AUDIT_TABLE_CONFIG: Record<string, AuditTableConfig> = {
  boards: {
    resolveScope: async row => boardScope(row),
    resolveTargetName: async row => rowString(row, 'name') || rowString(row, 'id'),
    prewarm: async (beforeRow, afterRow, res) => {
      const before = res.collectMetadataIds(beforeRow?.metadata);
      const after = res.collectMetadataIds(afterRow?.metadata);
      await Promise.all([
        res.warmRoles([...before.roleIds, ...after.roleIds]),
        res.warmForms([...before.formIds, ...after.formIds]),
        res.warmStages([...before.stageIds, ...after.stageIds]),
      ]);
    },
    jsonFields: { metadata: formatBoardMetadataValue },
    // Inner toggles audited as individual rows -> rendered as a nested diff tree.
    deepJsonFields: { metadata: ['ticketFormConfig'] },
    fieldFormatters: { flowPlan: value => formatFlowPlan(value) },
    deleteSummary: { field: 'name' },
  },

  stages: {
    resolveScope: async row => boardScope(row),
    resolveTargetName: async row => rowString(row, 'name') || rowString(row, 'id'),
    createDefaults: { requestApprovalOnEntry: false },
    deleteSummary: { field: 'name' },
  },

  stage_transitions: {
    resolveScope: async row => boardScope(row),
    resolveTargetName: async (row, res) => {
      await res.warmStages([String(row.toStageId), row.fromStageId ? String(row.fromStageId) : ''].filter(Boolean));
      return transitionLabel(row, res);
    },
    prewarm: async (beforeRow, afterRow, res) => {
      await res.warmForms(
        [beforeRow?.formId, afterRow?.formId].filter(Boolean).map(String),
      );
    },
    fieldFormatters: {
      formId: (value, res) => (value ? res.formName(String(value)) : null),
    },
    createDefaults: {
      requiresApproval: false,
      bypassApprovalForAutomation: false,
      requestApprovalOnEntry: false,
      visitSlaMode: 'STAGE_DEFAULT',
      onReenter: 'RESET',
    },
    deleteSummary: {
      field: 'transition',
      value: (row, res) => transitionLabel(row, res),
    },
  },

  stage_approvers: {
    resolveScope: async (row, res) => {
      if (row.stageId) {
        const boardId = await res.resolveStageBoardId(String(row.stageId));
        return boardId ? { entityType: AuditEntityType.BOARD, entityId: boardId } : null;
      }
      if (row.transitionId) {
        const boardId = await res.resolveTransitionBoardId(String(row.transitionId));
        return boardId ? { entityType: AuditEntityType.BOARD, entityId: boardId } : null;
      }
      return null;
    },
    resolveTargetName: async (row, res) => {
      if (row.stageId) {
        await res.warmStages([String(row.stageId)]);
        return res.stageName(String(row.stageId));
      }
      if (row.transitionId) return res.resolveTransitionLabel(String(row.transitionId));
      return rowString(row, 'id');
    },
    prewarm: async (beforeRow, afterRow, res) => {
      const ids = [beforeRow?.userId, beforeRow?.roleId, afterRow?.userId, afterRow?.roleId]
        .filter(Boolean)
        .map(String);
      await Promise.all([res.warmUsers(ids), res.warmRoles(ids)]);
    },
    fieldFormatters: {
      userId: (value, res) => (value ? res.userName(String(value)) : null),
      roleId: (value, res) => (value ? res.roleName(String(value)) : null),
      approverType: value => String(value ?? 'USER'),
    },
    ignoreFields: ['stageId', 'transitionId'],
    createDefaults: { approverType: 'USER' },
    // Approver rows are deleted and reinserted (new ids) on board save — pair by
    // natural key. The DELETE row's field name matches the CREATE diff's userId
    // row so identical replacements reconcile away.
    reconcileKey: row =>
      [rowString(row, 'stageId') || rowString(row, 'transitionId'), rowString(row, 'userId')].join(
        '|',
      ),
    deleteSummary: { field: 'userId', value: (row, res) => approverLabel(row, res) },
  },

  stage_pr_status_mappings: {
    resolveScope: async (row, res) => {
      const boardId = await res.resolveStageBoardId(rowString(row, 'stageId'));
      return boardId ? { entityType: AuditEntityType.BOARD, entityId: boardId } : null;
    },
    resolveTargetName: async (row, res) => {
      await res.warmStages([rowString(row, 'stageId')]);
      return res.stageName(rowString(row, 'stageId'));
    },
    ignoreFields: ['stageId'],
    deleteSummary: { field: 'prStatus' },
  },

  board_sla_policies: {
    resolveScope: async row => boardScope(row),
    resolveTargetName: async row => `${rowString(row, 'priority') || 'SLA'} priority SLA`,
    deleteSummary: { field: 'priority' },
  },

  forms_context_mapping: {
    resolveScope: async (row, res) => {
      const contextType = rowString(row, 'contextType');
      if (contextType === 'BOARD') {
        return { entityType: AuditEntityType.BOARD, entityId: rowString(row, 'contextId') };
      }
      if (contextType === 'STAGE') {
        const boardId = await res.resolveStageBoardId(rowString(row, 'contextId'));
        return boardId ? { entityType: AuditEntityType.BOARD, entityId: boardId } : null;
      }
      return null;
    },
    resolveTargetName: async (row, res) => {
      const contextType = rowString(row, 'contextType');
      if (contextType === 'BOARD') {
        await res.warmBoards([rowString(row, 'contextId')]);
        return res.boardName(rowString(row, 'contextId'));
      }
      if (contextType === 'STAGE') {
        await res.warmStages([rowString(row, 'contextId')]);
        return res.stageName(rowString(row, 'contextId'));
      }
      return rowString(row, 'contextId');
    },
    prewarm: async (beforeRow, afterRow, res) => {
      await res.warmForms(
        [beforeRow?.formId, afterRow?.formId].filter(Boolean).map(String),
      );
    },
    fieldFormatters: {
      formId: (value, res) => (value ? res.formName(String(value)) : null),
    },
    ignoreFields: ['contextId', 'contextType', 'entityType'],
    // Board save rewrites the mapping row (delete + insert, same natural key).
    reconcileKey: row =>
      [rowString(row, 'contextId'), rowString(row, 'formId')].join('|'),
    deleteSummary: { field: 'formId' },
  },

  forms: {
    resolveScope: async (row, res) => {
      await res.warmFormBoards([rowString(row, 'id')]);
      return res.boardIdsForForm(rowString(row, 'id')).map(entityId => ({
        entityType: AuditEntityType.BOARD,
        entityId,
      }));
    },
    resolveTargetName: async row => rowString(row, 'formName') || rowString(row, 'id'),
    deleteSummary: { field: 'formName' },
  },

  form_fields: {
    resolveScope: async (row, res) => {
      await res.warmFormBoards([rowString(row, 'formId')]);
      return res.boardIdsForForm(rowString(row, 'formId')).map(entityId => ({
        entityType: AuditEntityType.BOARD,
        entityId,
      }));
    },
    prewarm: async (beforeRow, afterRow, res) => {
      await Promise.all([
        res.warmForms([beforeRow?.formId, afterRow?.formId].filter(Boolean).map(String)),
        res.warmGlobalFields(
          [beforeRow?.globalFieldId, afterRow?.globalFieldId].filter(Boolean).map(String),
        ),
      ]);
    },
    // fieldName is deprecated in favour of the shared global_fields definition —
    // resolve through it and prefix the owning form so the change group reads
    // "Ticket Form · Priority" instead of an opaque id.
    resolveTargetName: async (row, res) => {
      const fieldLabel =
        rowString(row, 'fieldName') || res.globalFieldName(rowString(row, 'globalFieldId')) || rowString(row, 'id');
      const formName = res.formName(rowString(row, 'formId'));
      return formName ? `${formName} · ${fieldLabel}` : fieldLabel;
    },
    fieldFormatters: {
      // fieldEnum arrives as a json() array; fieldOptions as a JSON-stringified
      // {id,value}[] in a string column — both collapse to their option labels.
      fieldEnum: value => {
        if (Array.isArray(value)) return value.map(String).join(', ') || null;
        return compactJson(value);
      },
      fieldOptions: value => {
        if (value === null || value === undefined) return null;
        try {
          const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
          if (!Array.isArray(parsed)) return compactJson(parsed);
          const labels = parsed
            .map(option => String((option as { value?: unknown }).value ?? ''))
            .filter(Boolean);
          return labels.length > 0 ? labels.join(', ') : null;
        } catch {
          return compactJson(value);
        }
      },
    },
    ignoreFields: ['formId', 'globalFieldId', 'sequenceNumber', 'parentOptionId'],
    createDefaults: { isOptional: false },
    deleteSummary: { field: 'fieldName' },
  },

  user_groups: {
    resolveScope: async row => assignmentScope(row),
    resolveTargetName: async row => rowString(row, 'name') || rowString(row, 'id'),
    // Diff metadata per sub-key (compact fallback) rather than one whole-blob value.
    jsonFields: { metadata: (_key, value) => compactJson(value) },
    createDefaults: { isActive: true, autoRotationEnabled: false, reassignOnUnavailable: false },
    deleteSummary: { field: 'name' },
  },

  user_assignment_states: {
    resolveScope: async row => assignmentScope(row),
    resolveTargetName: async (row, res) => {
      await res.warmUsers([rowString(row, 'userId')]);
      return res.userName(rowString(row, 'userId'));
    },
    ignoreFields: ['userId', 'userGroupId'],
    createDefaults: { onCall: true, isActiveForAssignment: true },
    deleteSummary: { field: 'member', value: (row, res) => res.userName(rowString(row, 'userId')) },
  },

  user_group_mappings: {
    resolveScope: async row => assignmentScope(row),
    resolveTargetName: async (row, res) => {
      await res.warmUsers([rowString(row, 'userId')]);
      return res.userName(rowString(row, 'userId'));
    },
    prewarm: async (beforeRow, afterRow, res) => {
      await res.warmRoles(
        [beforeRow?.roleId, afterRow?.roleId].filter(Boolean).map(String),
      );
    },
    fieldFormatters: {
      roleId: (value, res) => (value ? res.roleName(String(value)) : null),
    },
    ignoreFields: ['userId', 'userGroupId'],
    createDefaults: { isDeleted: false },
    deleteSummary: { field: 'member', value: (row, res) => res.userName(rowString(row, 'userId')) },
  },

  board_complexity_scores: {
    resolveScope: async row => assignmentScope(row),
    resolveTargetName: async (row, res) => {
      await res.warmBoards([rowString(row, 'boardId')]);
      return res.boardName(rowString(row, 'boardId'));
    },
    ignoreFields: ['boardId', 'userGroupId'],
    createDefaults: { usePercentage: false },
    deleteSummary: { field: 'weight' },
  },

  user_expertise_mappings: {
    resolveScope: async row => assignmentScope(row),
    resolveTargetName: async (row, res) => {
      await res.warmBoards([rowString(row, 'boardId')]);
      return res.boardName(rowString(row, 'boardId'));
    },
    ignoreFields: ['boardId', 'userGroupId', 'userId'],
    createDefaults: { hasExpertise: false, percentage: 0, maxTickets: 0 },
    deleteSummary: { field: 'hasExpertise' },
  },
};

