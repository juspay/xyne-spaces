import type {
  AgentCreateChatPatch,
  AgentCreateConflict,
  AgentCreateField,
  AgentCreateFormState,
} from './types';
import { toolIdsFromForm } from './types';
import { sanitizeAgentCanvasName } from './canvasFromIdentity.ts';

export interface FieldLock {
  focused: AgentCreateField | null;
  dirty: Partial<Record<AgentCreateField, boolean>>;
}

export interface MergeChatResult {
  next: AgentCreateFormState;
  conflicts: AgentCreateConflict[];
  changed: AgentCreateField[];
}

const PATCH_FIELDS: AgentCreateField[] = [
  'name',
  'slug',
  'description',
  'systemPrompt',
  'tools',
  'skills',
  'knowledge',
];

function hasPatchValue(patch: AgentCreateChatPatch, field: AgentCreateField): boolean {
  switch (field) {
    case 'name':
      return typeof patch.name === 'string';
    case 'slug':
      return typeof patch.slug === 'string';
    case 'description':
      return typeof patch.description === 'string';
    case 'systemPrompt':
      return typeof patch.systemPrompt === 'string';
    case 'tools':
      return patch.tools !== undefined;
    case 'skills':
      return patch.selectedSkillIds !== undefined;
    case 'knowledge':
      return patch.selectedKbResources !== undefined || patch.selectedKbScope !== undefined;
    default:
      return false;
  }
}

function fieldEquals(
  current: AgentCreateFormState,
  patch: AgentCreateChatPatch,
  field: AgentCreateField,
): boolean {
  switch (field) {
    case 'name':
      return (patch.name ?? '') === current.name;
    case 'slug':
      return (patch.slug ?? '') === current.slug;
    case 'description':
      return (patch.description ?? '') === current.description;
    case 'systemPrompt':
      return (patch.systemPrompt ?? '') === current.systemPrompt;
    case 'tools':
      return (
        JSON.stringify(toolIdsFromForm(current)) ===
        JSON.stringify(toolIdsFromForm({ tools: patch.tools ?? current.tools }))
      );
    case 'skills':
      return JSON.stringify(current.selectedSkillIds) === JSON.stringify(patch.selectedSkillIds);
    case 'knowledge':
      return (
        (patch.selectedKbScope === undefined ||
          patch.selectedKbScope === current.selectedKbScope) &&
        (patch.selectedKbResources === undefined ||
          JSON.stringify(current.selectedKbResources) === JSON.stringify(patch.selectedKbResources))
      );
    default:
      return true;
  }
}

function applyField(
  current: AgentCreateFormState,
  patch: AgentCreateChatPatch,
  field: AgentCreateField,
): AgentCreateFormState {
  switch (field) {
    case 'name': {
      const nextName = patch.name ?? current.name;
      return {
        ...current,
        name: typeof nextName === 'string' ? sanitizeAgentCanvasName(nextName) : nextName,
      };
    }
    case 'slug':
      return {
        ...current,
        slug: patch.slug ?? current.slug,
        slugManual: true,
      };
    case 'description':
      return { ...current, description: patch.description ?? current.description };
    case 'systemPrompt':
      return { ...current, systemPrompt: patch.systemPrompt ?? current.systemPrompt };
    case 'tools':
      return patch.tools ? { ...current, tools: patch.tools } : current;
    case 'skills':
      return patch.selectedSkillIds
        ? { ...current, selectedSkillIds: patch.selectedSkillIds }
        : current;
    case 'knowledge':
      return {
        ...current,
        ...(patch.selectedKbScope ? { selectedKbScope: patch.selectedKbScope } : {}),
        ...(patch.selectedKbResources ? { selectedKbResources: patch.selectedKbResources } : {}),
      };
    default:
      return current;
  }
}

export function slicePatch(
  patch: AgentCreateChatPatch,
  field: AgentCreateField,
): AgentCreateChatPatch {
  switch (field) {
    case 'name':
      return patch.name !== undefined ? { name: patch.name } : {};
    case 'slug':
      return patch.slug !== undefined ? { slug: patch.slug } : {};
    case 'description':
      return patch.description !== undefined ? { description: patch.description } : {};
    case 'systemPrompt':
      return patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {};
    case 'tools':
      return patch.tools !== undefined ? { tools: patch.tools } : {};
    case 'skills':
      return patch.selectedSkillIds !== undefined
        ? { selectedSkillIds: patch.selectedSkillIds }
        : {};
    case 'knowledge': {
      const next: AgentCreateChatPatch = {};
      if (patch.selectedKbScope !== undefined) next.selectedKbScope = patch.selectedKbScope;
      if (patch.selectedKbResources !== undefined)
        next.selectedKbResources = patch.selectedKbResources;
      return next;
    }
    default:
      return {};
  }
}

/**
 * Last-write-wins per field, never clobber a focused or dirty input.
 * Conflicting fields stay as-is and surface Keep mine / Use chat.
 */
export function mergeChatPatch(
  current: AgentCreateFormState,
  incoming: AgentCreateChatPatch,
  lock: FieldLock,
  existingConflicts: AgentCreateConflict[] = [],
): MergeChatResult {
  let next = current;
  const changed: AgentCreateField[] = [];
  const conflictsByField = new Map(existingConflicts.map(conflict => [conflict.field, conflict]));

  for (const field of PATCH_FIELDS) {
    if (!hasPatchValue(incoming, field)) {
      continue;
    }
    if (fieldEquals(current, incoming, field)) {
      conflictsByField.delete(field);
      continue;
    }
    const locked = lock.focused === field || Boolean(lock.dirty[field]);
    if (locked) {
      conflictsByField.set(field, { field, chat: slicePatch(incoming, field) });
      continue;
    }
    next = applyField(next, incoming, field);
    changed.push(field);
    conflictsByField.delete(field);
  }

  return {
    next,
    conflicts: [...conflictsByField.values()],
    changed,
  };
}

export function applyConflictChoice(
  current: AgentCreateFormState,
  conflict: AgentCreateConflict,
  choice: 'mine' | 'chat',
): AgentCreateFormState {
  if (choice === 'mine') {
    return current;
  }
  return applyField(current, conflict.chat, conflict.field);
}
