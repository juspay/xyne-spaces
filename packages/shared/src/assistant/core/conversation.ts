import {
  confirmPolicyOf,
  manyFieldsOf,
  type ActionDefinition,
  type ActionCatalog,
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
 * The conversation engine: a pure function that decides the next step of a request that may
 * take several turns (ask, choose, preview, or run). Every action goes through it, so they all
 * behave the same. The backend turns what the user said into an event and calls `advance`.
 */

/** A request being filled in. */
export interface Draft {
  id: string;
  action: string;
  values: Record<string, FieldValue>;
  /** Fields whose value was stated clearly, for the `when-unclear` confirmation policy. */
  certain: Record<string, boolean>;
  /** Optional fields already offered, and those the user declined. */
  offered: string[];
  skipped: string[];
  /** The field the last question was about. */
  asking: string | null;
  /** A spoken name matched several records; the user picks one. */
  choosing: { field: string; mention: string; candidates: Candidate[] } | null;
  /** A name that matched nothing, mentioned in the next question. */
  notFound: { field: string; mention: string } | null;
  /** Additional unresolved names from the same request, asked one at a time. */
  resolutionQueue: PendingResolution[];
  /** A search term held until its requested person or channel filters are resolved. */
  pendingLookup: { field: string; mention: string } | null;
  /**
   * Set while a preview waits for "yes": a fingerprint of exactly what the preview showed.
   * Any change to the draft clears it, so "yes" only ever runs what the user saw.
   */
  previewFingerprint: string | null;
}

export type PendingResolution =
  | { kind: 'choice'; field: string; mention: string; candidates: Candidate[] }
  | { kind: 'notFound'; field: string; mention: string };

export interface ConversationState {
  version: 1;
  /** Counter for draft ids; keeps the engine deterministic. */
  seq: number;
  active: Draft | null;
  /** Requests set aside by a switch to something else; the newest is last. */
  parked: Draft[];
}

export const EMPTY_CONVERSATION: ConversationState = {
  version: 1,
  seq: 0,
  active: null,
  parked: [],
};

/** At most this many requests are held for "continue"; the oldest is dropped. */
export const MAX_PARKED = 3;

/** One detail the interpreter found in what the user said, already resolved where possible. */
export type FieldUpdate =
  | { field: string; op: 'set'; value: FieldValue; certain: boolean }
  /** Adds one record to a `many` field ("also add Priya"). */
  | { field: string; op: 'add'; value: EntityRef; certain: boolean }
  | { field: string; op: 'remove'; id: string }
  /** Several records match the spoken name. */
  | { field: string; op: 'ambiguous'; mention: string; candidates: Candidate[] }
  /** Nothing matches the spoken name. */
  | { field: string; op: 'unknown'; mention: string }
  /** Keep a search term until its requested person or channel filters are resolved. */
  | { field: string; op: 'defer'; mention: string };

export type TurnEvent =
  /** A new request for an action, with whatever details it included. */
  | { type: 'request'; action: string; updates: FieldUpdate[] }
  /** More details (or corrections) for the request in progress. */
  | { type: 'details'; updates: FieldUpdate[] }
  /** Picks an offered option by id (chip tap, or a spoken choice matched by the interpreter). */
  | { type: 'choose'; optionId: string }
  | { type: 'yes' }
  | { type: 'no' }
  | { type: 'cancel' }
  /** "Continue": bring back the most recently parked request. */
  | { type: 'resume' };

export type EngineStep =
  | {
      kind: 'ask';
      draftId: string;
      action: string;
      field: string;
      prompt: string;
      options?: ChoiceOption[];
      /** The user said "no" to a detail the request needs, so the question comes again. */
      declined?: boolean;
    }
  | {
      kind: 'confirm';
      draftId: string;
      action: string;
      summary: string;
      /** What "yes" will approve; see `Draft.previewFingerprint`. */
      fingerprint: string;
    }
  | {
      kind: 'run';
      draftId: string;
      action: string;
      plan: Plan;
      /** The fingerprint of what ran, for traces and matching it to the preview. */
      fingerprint: string;
      /** Said once the plan succeeded. */
      done: string;
    }
  | { kind: 'cancelled'; action: string }
  | { kind: 'idle'; reason: 'nothing-pending' | 'nothing-parked' | 'unknown-action' };

export type EngineNote =
  | { kind: 'parked'; action: string; summary: string }
  | { kind: 'resumed'; action: string }
  /** After a run: a parked request is still waiting for "continue". */
  | { kind: 'still-parked'; action: string; summary: string }
  | { kind: 'ignored-field'; field: string };

export interface Advance {
  state: ConversationState;
  step: EngineStep;
  notes: EngineNote[];
}

export function advance(
  state: ConversationState,
  event: TurnEvent,
  catalog: ActionCatalog,
): Advance {
  const notes: EngineNote[] = [];
  let { active, parked, seq } = state;

  const definitionOf = (draft: Draft): ActionDefinition => {
    const definition = catalog.get(draft.action);
    if (!definition) throw new Error(`Unknown action in conversation: ${draft.action}`);
    return definition;
  };
  const finish = (next: Draft | null, step: EngineStep): Advance => ({
    state: { version: 1, seq, active: next, parked },
    step,
    notes,
  });
  // A request set aside in this very turn is reported once, as "parked", not also as waiting.
  const parkedNow = new Set<string>();
  const park = (draft: Draft): void => {
    parkedNow.add(draft.id);
    notes.push({
      kind: 'parked',
      action: draft.action,
      summary: summarizeDraft(draft, definitionOf(draft)),
    });
    parked = [...parked, { ...draft, previewFingerprint: null }].slice(-MAX_PARKED);
  };
  const run = (draft: Draft, fingerprint: string): Advance => {
    const waiting = parked.at(-1);
    if (waiting && !parkedNow.has(waiting.id)) {
      notes.push({
        kind: 'still-parked',
        action: waiting.action,
        summary: summarizeDraft(waiting, definitionOf(waiting)),
      });
    }
    return finish(null, runStep(draft, definitionOf(draft), fingerprint));
  };
  const proceed = (draft: Draft): Advance => {
    const next = nextStep(draft, definitionOf(draft));
    return next.kind === 'ready'
      ? run(next.draft, next.fingerprint)
      : finish(next.draft, next.step);
  };
  const update = (draft: Draft, updates: readonly FieldUpdate[]): Advance =>
    proceed(applyUpdates(draft, definitionOf(draft), updates, notes));

  switch (event.type) {
    case 'request': {
      const definition = catalog.get(event.action);
      if (!definition) return finish(active, { kind: 'idle', reason: 'unknown-action' });
      // A request is always new, even for the same action ("tell Priya…" while a DM to Daniel
      // waits): the current one is set aside. Corrections to it arrive as `details`.
      if (active && hasContent(active)) park(active);
      seq += 1;
      return update(newDraft(`d${seq}`, definition.id), event.updates);
    }

    case 'details':
      return active ? update(active, event.updates) : idle();

    case 'choose': {
      if (!active) return idle();
      if (active.choosing) {
        const { field, candidates } = active.choosing;
        const picked = candidates.find(candidate => candidate.id === event.optionId);
        if (!picked) return proceed(active);
        const many = definitionOf(active).fields[field]?.many;
        return update(active, [
          many && isEntityRef(picked.value)
            ? { field, op: 'add', value: picked.value, certain: true }
            : { field, op: 'set', value: picked.value, certain: true },
        ]);
      }
      const field = active.asking;
      const option = field
        ? definitionOf(active).fields[field]?.options?.find(choice => choice.id === event.optionId)
        : undefined;
      if (!field || !option) return proceed(active);
      return update(active, [{ field, op: 'set', value: option.id, certain: true }]);
    }

    case 'yes': {
      if (!active) return idle();
      if (active.previewFingerprint) {
        // Runs only what the preview showed: if the draft changed since, preview again.
        if (active.previewFingerprint !== fingerprintOf(active)) return proceed(invalidate(active));
        return run(active, active.previewFingerprint);
      }
      // "Yes" to "want to add anyone?" means "yes, I'll name them".
      const field = active.asking ? definitionOf(active).fields[active.asking] : undefined;
      if (active.asking && field && !field.required) {
        return finish(active, {
          kind: 'ask',
          draftId: active.id,
          action: active.action,
          field: active.asking,
          prompt: renderTemplate(field.ask, active.values),
        });
      }
      return proceed(active);
    }

    case 'no': {
      if (!active) return idle();
      if (active.previewFingerprint)
        return finish(null, { kind: 'cancelled', action: active.action });
      if (active.choosing) {
        const field = active.choosing.field;
        if (!definitionOf(active).fields[field]?.required) {
          return proceed({
            ...active,
            asking: null,
            choosing: null,
            skipped: [...active.skipped, field],
            resolutionQueue: active.resolutionQueue.filter(item => item.field !== field),
          });
        }
        return proceed({ ...active, choosing: null });
      }
      const skippedField = active.asking;
      const field = skippedField ? definitionOf(active).fields[skippedField] : undefined;
      if (skippedField && field && !field.required) {
        return proceed({
          ...active,
          skipped: [...active.skipped, skippedField],
          asking: null,
          choosing: null,
          notFound: active.notFound?.field === skippedField ? null : active.notFound,
          resolutionQueue: active.resolutionQueue.filter(item => item.field !== skippedField),
        });
      }
      const next = proceed(active);
      return next.step.kind === 'ask' ? { ...next, step: { ...next.step, declined: true } } : next;
    }

    case 'cancel':
      return active ? finish(null, { kind: 'cancelled', action: active.action }) : idle();

    case 'resume': {
      const latest = parked.at(-1);
      if (!latest) return finish(active, { kind: 'idle', reason: 'nothing-parked' });
      parked = parked.slice(0, -1);
      if (active && hasContent(active)) park(active);
      notes.push({ kind: 'resumed', action: latest.action });
      return proceed({ ...latest, previewFingerprint: null });
    }
  }

  function idle(): Advance {
    return finish(active, { kind: 'idle', reason: 'nothing-pending' });
  }
}

type Next =
  | { kind: 'step'; draft: Draft; step: EngineStep }
  /** Complete, and allowed to run without a preview. */
  | { kind: 'ready'; draft: Draft; fingerprint: string };

/** What a draft needs next: a pick, a missing detail, an optional offer, a preview, or nothing. */
function nextStep(draft: Draft, definition: ActionDefinition): Next {
  const base = { draftId: draft.id, action: draft.action };
  const ask = (field: string, prompt: string, options?: ChoiceOption[]): EngineStep => ({
    ...base,
    kind: 'ask',
    field,
    prompt,
    ...(options ? { options } : {}),
  });

  if (!draft.choosing && !draft.notFound && draft.resolutionQueue.length > 0) {
    const [pending, ...resolutionQueue] = draft.resolutionQueue;
    if (pending?.kind === 'choice') {
      return nextStep({ ...draft, resolutionQueue, choosing: pending }, definition);
    }
    if (pending?.kind === 'notFound') {
      return nextStep({ ...draft, resolutionQueue, notFound: pending }, definition);
    }
  }

  if (draft.choosing) {
    const { field, mention, candidates } = draft.choosing;
    const question = definition.fields[field]?.choose ?? 'Which one do you mean by “{mention}”?';
    const options = candidates.map(({ id, label, detail }) => ({
      id,
      label,
      ...(detail ? { detail } : {}),
    }));
    return {
      kind: 'step',
      draft: { ...draft, asking: field },
      step: ask(field, question.replace('{mention}', mention), options),
    };
  }

  // A name that matched nobody is always reported, for optional details too ("add Zorro").
  const notFound = draft.notFound ? definition.fields[draft.notFound.field] : undefined;
  if (draft.notFound && notFound) {
    const { field, mention } = draft.notFound;
    return {
      kind: 'step',
      // Keep the missing value pending until it is resolved or explicitly skipped. An aside
      // (for example, "what can you do?") advances the draft without answering this question.
      draft: { ...draft, asking: field },
      step: ask(
        field,
        `I couldn't find “${mention}”. ${renderTemplate(notFound.ask, draft.values)}`,
      ),
    };
  }

  for (const [id, field] of Object.entries(definition.fields)) {
    if (!field.required || hasValue(draft.values[id])) continue;
    return {
      kind: 'step',
      draft: { ...draft, asking: id },
      step: ask(id, renderTemplate(field.ask, draft.values), field.options),
    };
  }

  for (const [id, field] of Object.entries(definition.fields)) {
    if (field.required || !field.offer || hasValue(draft.values[id])) continue;
    if (draft.offered.includes(id) || draft.skipped.includes(id)) continue;
    return {
      kind: 'step',
      draft: { ...draft, asking: id, offered: [...draft.offered, id] },
      step: ask(id, renderTemplate(field.offer, draft.values)),
    };
  }

  const fingerprint = fingerprintOf(draft);
  const clear = Object.keys(draft.values).every(id => draft.certain[id]);
  const policy = confirmPolicyOf(definition);
  if (policy === 'never' || (policy === 'when-unclear' && clear)) {
    return { kind: 'ready', draft, fingerprint };
  }
  return {
    kind: 'step',
    draft: { ...draft, asking: null, previewFingerprint: fingerprint },
    step: {
      ...base,
      kind: 'confirm',
      summary: renderTemplate(definition.summarize, draft.values),
      fingerprint,
    },
  };
}

function runStep(draft: Draft, definition: ActionDefinition, fingerprint: string): EngineStep {
  return {
    kind: 'run',
    draftId: draft.id,
    action: draft.action,
    plan: bindPlan(definition.plan as PlanStepDef[], manyFieldsOf(definition), draft.values),
    fingerprint,
    done: renderTemplate(definition.done, draft.values),
  };
}

function applyUpdates(
  draft: Draft,
  definition: ActionDefinition,
  updates: readonly FieldUpdate[],
  notes: EngineNote[],
): Draft {
  let next = draft;
  for (const update of updates) {
    const id = update.field;
    if (!definition.fields[id]) {
      notes.push({ kind: 'ignored-field', field: id });
      continue;
    }
    // Any change voids a preview the user has not approved yet.
    next = invalidate(next);
    switch (update.op) {
      case 'set':
        next = {
          ...next,
          values: { ...next.values, [id]: update.value },
          certain: { ...next.certain, [id]: update.certain },
          skipped: next.skipped.filter(skipped => skipped !== id),
          choosing: next.choosing?.field === id ? null : next.choosing,
          notFound: next.notFound?.field === id ? null : next.notFound,
          resolutionQueue: definition.fields[id]?.many
            ? next.resolutionQueue
            : next.resolutionQueue.filter(item => item.field !== id),
        };
        break;
      case 'add': {
        const current = next.values[id];
        const records = Array.isArray(current) ? current : [];
        const alreadyPresent = records.some(record => record.id === update.value.id);
        next = {
          ...next,
          values: alreadyPresent ? next.values : { ...next.values, [id]: [...records, update.value] },
          certain: alreadyPresent
            ? next.certain
            : { ...next.certain, [id]: (next.certain[id] ?? true) && update.certain },
          skipped: next.skipped.filter(skipped => skipped !== id),
          choosing: next.asking === id && next.choosing?.field === id ? null : next.choosing,
          notFound: next.asking === id && next.notFound?.field === id ? null : next.notFound,
        };
        break;
      }
      case 'remove': {
        const current = next.values[id];
        if (!Array.isArray(current)) break;
        const values = { ...next.values };
        const remaining = current.filter(record => record.id !== update.id);
        if (remaining.length) values[id] = remaining;
        else delete values[id];
        next = { ...next, values };
        break;
      }
      case 'ambiguous':
        if (!definition.fields[id]?.many) {
          const values = { ...next.values };
          const certain = { ...next.certain };
          delete values[id];
          delete certain[id];
          next = { ...next, values, certain };
        }
        next = addPendingResolution(next, {
          kind: 'choice',
          field: id,
          mention: update.mention,
          candidates: update.candidates,
        }, Boolean(definition.fields[id]?.many));
        break;
      case 'unknown':
        if (!definition.fields[id]?.many) {
          const values = { ...next.values };
          const certain = { ...next.certain };
          delete values[id];
          delete certain[id];
          next = { ...next, values, certain };
        }
        next = addPendingResolution(
          next,
          { kind: 'notFound', field: id, mention: update.mention },
          Boolean(definition.fields[id]?.many),
        );
        break;
      case 'defer': {
        const values = { ...next.values };
        delete values[id];
        const certain = { ...next.certain };
        delete certain[id];
        next = {
          ...next,
          values,
          certain,
          choosing: next.choosing?.field === id ? null : next.choosing,
          notFound: next.notFound?.field === id ? null : next.notFound,
          pendingLookup: { field: id, mention: update.mention },
        };
        break;
      }
    }
  }
  return next;
}

function newDraft(id: string, action: string): Draft {
  return {
    id,
    action,
    values: {},
    certain: {},
    offered: [],
    skipped: [],
    asking: null,
    choosing: null,
    notFound: null,
    resolutionQueue: [],
    pendingLookup: null,
    previewFingerprint: null,
  };
}

function addPendingResolution(draft: Draft, pending: PendingResolution, many: boolean): Draft {
  const resolvesActiveField =
    draft.choosing?.field === pending.field || draft.notFound?.field === pending.field;
  const answeringActiveField = draft.asking === pending.field;

  // A correction to the question on screen replaces that unresolved mention. For a `many`
  // field, only replace once per answer so other names from the same sentence remain queued.
  if (resolvesActiveField && (!many || answeringActiveField)) {
    return {
      ...draft,
      asking: null,
      choosing: pending.kind === 'choice' ? pending : null,
      notFound: pending.kind === 'notFound' ? pending : null,
      resolutionQueue: many
        ? draft.resolutionQueue
        : draft.resolutionQueue.filter(item => item.field !== pending.field),
    };
  }

  if (!many) {
    const queuedIndex = draft.resolutionQueue.findIndex(item => item.field === pending.field);
    if (queuedIndex >= 0) {
      return {
        ...draft,
        resolutionQueue: draft.resolutionQueue.map((item, index) =>
          index === queuedIndex ? pending : item,
        ),
      };
    }
  }
  if (!draft.choosing && !draft.notFound) {
    return pending.kind === 'choice'
      ? { ...draft, choosing: pending }
      : { ...draft, notFound: pending };
  }
  return { ...draft, resolutionQueue: [...draft.resolutionQueue, pending] };
}

function invalidate(draft: Draft): Draft {
  return draft.previewFingerprint ? { ...draft, previewFingerprint: null } : draft;
}

function hasContent(draft: Draft): boolean {
  return (
    Object.keys(draft.values).length > 0 ||
    draft.asking !== null ||
    draft.choosing !== null ||
    draft.notFound !== null ||
    draft.resolutionQueue.length > 0 ||
    draft.pendingLookup !== null
  );
}

/** The preview line when complete; otherwise what is known so far ("create_channel (name: ABC)"). */
export function summarizeDraft(draft: Draft, definition: ActionDefinition): string {
  const complete = Object.entries(definition.fields).every(
    ([id, field]) => !field.required || hasValue(draft.values[id]),
  );
  if (complete) return renderTemplate(definition.summarize, draft.values);
  const known = Object.entries(draft.values)
    .map(([id, value]) => `${id}: ${describeValue(value)}`)
    .join(', ');
  return known ? `${definition.id} (${known})` : definition.id;
}

/**
 * A fingerprint of exactly what would run: the action, the draft, and every value. It is not a
 * secret; it only tells whether anything changed since a preview was shown.
 */
export function fingerprintOf(draft: Pick<Draft, 'id' | 'action' | 'values'>): string {
  return `${draft.id}.${fnv1a(stableStringify([draft.action, draft.values]))}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map(
        key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      );
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
