import {
  confirmPolicyOf,
  manyFieldsOf,
  type ActionCatalog,
  type ActionDefinition,
} from './action.js';
import type { Plan } from './operations.js';
import {
  isEntityRef,
  type Candidate,
  type ChoiceOption,
  type EntityRef,
  type FieldValue,
} from './references.js';
import {
  bindPlan,
  describeValue,
  hasValue,
  renderTemplate,
  type PlanStepDef,
} from './templates.js';

/**
 * The conversation engine: decides the next step of a request that may take several turns.
 * It is pure. The backend reads what the user said into an event, calls `advance`, and acts on
 * the step: a question, a lookup, a preview, or a plan to run.
 */

/** A name the user said that is not settled yet. No options means nothing matched. */
export interface OpenName {
  field: string;
  said: string;
  options: Candidate[];
}

/** What the last reply asked for. */
export type Awaiting = { kind: 'field'; field: string } | { kind: 'preview'; fingerprint: string };

/** A request being filled in. */
export interface Draft {
  id: string;
  action: string;
  values: Record<string, FieldValue>;
  /** Fields whose value was not stated exactly, so a `send` previews first. */
  unsure: string[];
  /** Names to settle, in the order they were said. The first one is asked about. */
  open: OpenName[];
  /** Names to look up once every other name is settled, like a search narrowed by them. */
  later: Array<{ field: string; said: string }>;
  /** Optional fields already offered or declined. */
  offered: string[];
  awaiting: Awaiting | null;
}

export interface ConversationState {
  version: 2;
  /** Counter for draft ids, so the engine stays deterministic. */
  seq: number;
  active: Draft | null;
}

export const EMPTY_CONVERSATION: ConversationState = { version: 2, seq: 0, active: null };

/** One detail read from what the user said, already looked up where possible. */
export type FieldUpdate =
  | { field: string; op: 'set'; value: FieldValue; certain: boolean }
  /** Adds one record to a field that holds several ("also add Priya"). */
  | { field: string; op: 'add'; value: EntityRef; certain: boolean }
  | { field: string; op: 'remove'; id: string }
  /** A name that matched several records, or none. */
  | { field: string; op: 'open'; said: string; options: Candidate[] }
  | { field: string; op: 'later'; said: string };

export type TurnEvent =
  | { type: 'request'; action: string; updates: FieldUpdate[] }
  | { type: 'details'; updates: FieldUpdate[] }
  /** A tapped or spoken option of the question on screen. */
  | { type: 'choose'; optionId: string }
  | { type: 'yes' }
  | { type: 'no' }
  | { type: 'cancel' };

export type EngineStep =
  | { kind: 'ask'; field: string; prompt: string; options?: ChoiceOption[]; declined?: boolean }
  | { kind: 'choose'; field: string; said: string; prompt?: string; options: ChoiceOption[] }
  | { kind: 'not-found'; field: string; said: string; prompt: string }
  | { kind: 'lookup'; field: string; said: string }
  | { kind: 'confirm'; summary: string; fingerprint: string }
  | { kind: 'run'; action: string; plan: Plan; done: string }
  | { kind: 'cancelled' }
  | { kind: 'idle'; reason: 'nothing-pending' | 'unknown-action' };

export interface Advance {
  state: ConversationState;
  step: EngineStep;
}

export function advance(
  state: ConversationState,
  event: TurnEvent,
  catalog: ActionCatalog,
): Advance {
  const draft = state.active;
  if (event.type === 'request') {
    const action = catalog.get(event.action);
    if (!action) return { state, step: { kind: 'idle', reason: 'unknown-action' } };
    const seq = state.seq + 1;
    const fresh = newDraft(`d${seq}`, action.id);
    return proceed({ ...state, seq }, update(fresh, action, event.updates), action);
  }
  if (!draft) {
    return { state, step: { kind: 'idle', reason: 'nothing-pending' } };
  }

  const action = catalog.get(draft.action);
  if (!action) throw new Error(`Unknown action in conversation: ${draft.action}`);
  switch (event.type) {
    case 'details':
      return proceed(state, update(draft, action, event.updates), action);
    case 'choose':
      return proceed(state, choose(draft, action, event.optionId), action);
    case 'yes':
      return yes(state, draft, action);
    case 'no':
      return no(state, draft, action);
    case 'cancel':
      return { state: { ...state, active: null }, step: { kind: 'cancelled' } };
  }
}

function yes(state: ConversationState, draft: Draft, action: ActionDefinition): Advance {
  const { awaiting } = draft;
  if (awaiting?.kind === 'preview') {
    // "Yes" runs only what the preview showed; anything changed since is previewed again.
    if (awaiting.fingerprint !== fingerprintOf(draft, action)) {
      return proceed(state, { ...draft, awaiting: null }, action);
    }
    return { state: { ...state, active: null }, step: runStep(draft, action) };
  }
  // "Yes" to "want to add anyone?" means "yes, I'll name them".
  const offered = awaiting && action.fields[awaiting.field];
  if (awaiting && offered && !offered.required) {
    return {
      state,
      step: {
        kind: 'ask',
        field: awaiting.field,
        prompt: renderTemplate(offered.ask, draft.values),
      },
    };
  }
  return proceed(state, draft, action);
}

function no(state: ConversationState, draft: Draft, action: ActionDefinition): Advance {
  if (draft.awaiting?.kind === 'preview') {
    return { state: { ...state, active: null }, step: { kind: 'cancelled' } };
  }
  const field = draft.open[0]?.field ?? draft.awaiting?.field;
  if (field && !action.fields[field]?.required) {
    return proceed(state, decline(draft, field), action);
  }
  const next = proceed(state, { ...draft, open: draft.open.slice(1) }, action);
  return next.step.kind === 'ask' ? { ...next, step: { ...next.step, declined: true } } : next;
}

/** The next thing the draft needs, in order: a name settled, a lookup, a detail, a preview. */
function proceed(state: ConversationState, draft: Draft, action: ActionDefinition): Advance {
  const { draft: next, step } = nextStep(draft, action);
  return { state: { ...state, active: next }, step };
}

function nextStep(
  draft: Draft,
  action: ActionDefinition,
): { draft: Draft | null; step: EngineStep } {
  const asking = (field: string): Draft => ({ ...draft, awaiting: { kind: 'field', field } });

  const [name] = draft.open;
  if (name) {
    const field = action.fields[name.field];
    if (name.options.length === 0) {
      const prompt = renderTemplate(field?.ask ?? '', draft.values);
      return {
        draft: asking(name.field),
        step: { kind: 'not-found', field: name.field, said: name.said, prompt },
      };
    }
    const prompt = field?.choose?.replace('{mention}', name.said);
    return {
      draft: asking(name.field),
      step: {
        kind: 'choose',
        field: name.field,
        said: name.said,
        ...(prompt ? { prompt } : {}),
        options: name.options.map(({ id, label, detail }) => ({
          id,
          label,
          ...(detail ? { detail } : {}),
        })),
      },
    };
  }

  const [lookup] = draft.later;
  if (lookup) return { draft: { ...draft, awaiting: null }, step: { kind: 'lookup', ...lookup } };

  const fields = Object.entries(action.fields);
  const missing = fields.find(([id, field]) => field.required && !hasValue(draft.values[id]));
  if (missing) {
    const [id, field] = missing;
    const prompt = renderTemplate(field.ask, draft.values);
    return {
      draft: asking(id),
      step: {
        kind: 'ask',
        field: id,
        prompt,
        ...(field.options ? { options: field.options } : {}),
      },
    };
  }

  const offer = fields.find(
    ([id, field]) => field.offer && !hasValue(draft.values[id]) && !draft.offered.includes(id),
  );
  if (offer) {
    const [id, field] = offer;
    const prompt = renderTemplate(field.offer ?? '', draft.values);
    return {
      draft: { ...asking(id), offered: [...draft.offered, id] },
      step: { kind: 'ask', field: id, prompt },
    };
  }

  if (!needsPreview(draft, action)) return { draft: null, step: runStep(draft, action) };
  const fingerprint = fingerprintOf(draft, action);
  const summary = renderTemplate(action.summarize, draft.values);
  return {
    draft: { ...draft, awaiting: { kind: 'preview', fingerprint } },
    step: { kind: 'confirm', summary, fingerprint },
  };
}

function needsPreview(draft: Draft, action: ActionDefinition): boolean {
  const policy = confirmPolicyOf(action);
  if (policy !== 'when-unclear') return policy === 'always';
  return draft.unsure.some(field => hasValue(draft.values[field]));
}

function runStep(draft: Draft, action: ActionDefinition): EngineStep {
  return {
    kind: 'run',
    action: action.id,
    plan: bindPlan(action.plan as PlanStepDef[], manyFieldsOf(action), draft.values),
    done: renderTemplate(action.done, draft.values),
  };
}

/** Applies updates in order. Any change voids a preview that has not been approved. */
function update(draft: Draft, action: ActionDefinition, updates: readonly FieldUpdate[]): Draft {
  const start =
    draft.awaiting?.kind === 'preview' && updates.length ? { ...draft, awaiting: null } : draft;
  return updates.reduce((next, change) => applyUpdate(next, action, change), start);
}

function applyUpdate(draft: Draft, action: ActionDefinition, change: FieldUpdate): Draft {
  const field = action.fields[change.field];
  if (!field) return draft;
  const id = change.field;
  switch (change.op) {
    case 'set':
      return {
        ...settle(draft, id),
        values: { ...draft.values, [id]: change.value },
        unsure: mark(draft.unsure, id, !change.certain),
      };
    case 'add': {
      const records = asRecords(draft.values[id]);
      if (records.some(record => record.id === change.value.id)) return answered(draft, id);
      return {
        ...answered(draft, id),
        values: { ...draft.values, [id]: [...records, change.value] },
        unsure: change.certain ? draft.unsure : mark(draft.unsure, id, true),
      };
    }
    case 'remove': {
      const values = { ...draft.values };
      const remaining = asRecords(values[id]).filter(record => record.id !== change.id);
      if (remaining.length) values[id] = remaining;
      else delete values[id];
      return { ...draft, values };
    }
    case 'open': {
      const name = { field: id, said: change.said, options: change.options };
      return field.many ? openAnother(draft, name) : openInstead(clear(draft, id), name);
    }
    case 'later': {
      const cleared = clear(draft, id);
      return { ...cleared, later: [...cleared.later, { field: id, said: change.said }] };
    }
  }
}

/** A tapped or spoken option: a record for the name on screen, or a choice field's option. */
function choose(draft: Draft, action: ActionDefinition, optionId: string): Draft {
  const [name] = draft.open;
  if (name) {
    const picked = name.options.find(option => option.id === optionId);
    if (!picked) return draft;
    const rest = { ...draft, open: draft.open.slice(1), awaiting: null };
    const change: FieldUpdate =
      action.fields[name.field]?.many && isEntityRef(picked.value)
        ? { field: name.field, op: 'add', value: picked.value, certain: true }
        : { field: name.field, op: 'set', value: picked.value, certain: true };
    return applyUpdate(rest, action, change);
  }
  const field = draft.awaiting?.kind === 'field' ? draft.awaiting.field : undefined;
  const option = field && action.fields[field]?.options?.find(choice => choice.id === optionId);
  if (!field || !option) return draft;
  return applyUpdate(draft, action, { field, op: 'set', value: option.id, certain: true });
}

/** A single field has one value: a new one replaces anything still open or waiting for it. */
function settle(draft: Draft, id: string): Draft {
  return {
    ...draft,
    open: draft.open.filter(name => name.field !== id),
    later: draft.later.filter(item => item.field !== id),
  };
}

/** An answer to the name on screen settles that name, once. */
function answered(draft: Draft, id: string): Draft {
  const onScreen = draft.awaiting?.kind === 'field' && draft.awaiting.field === id;
  if (!onScreen || draft.open[0]?.field !== id) return draft;
  return { ...draft, open: draft.open.slice(1), awaiting: null };
}

/** A single field: its new unsettled name replaces the old one, where it was in the order. */
function openInstead(draft: Draft, name: OpenName): Draft {
  const at = draft.open.findIndex(open => open.field === name.field);
  if (at < 0) return { ...draft, open: [...draft.open, name] };
  return { ...draft, open: draft.open.map((open, index) => (index === at ? name : open)) };
}

/** A field of several: a correction replaces the name on screen; other names wait their turn. */
function openAnother(draft: Draft, name: OpenName): Draft {
  const onScreen = draft.awaiting?.kind === 'field' && draft.awaiting.field === name.field;
  if (onScreen && draft.open[0]?.field === name.field) {
    return { ...draft, open: [name, ...draft.open.slice(1)], awaiting: null };
  }
  return { ...draft, open: [...draft.open, name] };
}

/** Forgets a single field's value and any lookup waiting for it, before it is settled again. */
function clear(draft: Draft, id: string): Draft {
  const values = { ...draft.values };
  delete values[id];
  return {
    ...draft,
    values,
    unsure: mark(draft.unsure, id, false),
    later: draft.later.filter(item => item.field !== id),
  };
}

/** An optional field the user said no to: forget its open names and do not offer it again. */
function decline(draft: Draft, id: string): Draft {
  return {
    ...draft,
    open: draft.open.filter(name => name.field !== id),
    later: draft.later.filter(item => item.field !== id),
    offered: draft.offered.includes(id) ? draft.offered : [...draft.offered, id],
    awaiting: null,
  };
}

function mark(fields: readonly string[], id: string, on: boolean): string[] {
  const rest = fields.filter(field => field !== id);
  return on ? [...rest, id] : rest;
}

function asRecords(value: FieldValue | undefined): EntityRef[] {
  return Array.isArray(value) ? value : [];
}

function newDraft(id: string, action: string): Draft {
  return { id, action, values: {}, unsure: [], open: [], later: [], offered: [], awaiting: null };
}

/** The preview line when complete; otherwise what is known so far ("create_channel (name: ABC)"). */
export function summarizeDraft(draft: Draft, action: ActionDefinition): string {
  const complete = Object.entries(action.fields).every(
    ([id, field]) => !field.required || hasValue(draft.values[id]),
  );
  if (complete) return renderTemplate(action.summarize, draft.values);
  const known = Object.entries(draft.values)
    .map(([id, value]) => `${id}: ${describeValue(value)}`)
    .join(', ');
  return known ? `${action.id} (${known})` : action.id;
}

/** Changes whenever the action or any value changes, so a stale preview cannot be approved. */
function fingerprintOf(draft: Draft, action: ActionDefinition): string {
  return `${draft.id}.${fnv1a(stableStringify([action, draft.values]))}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
