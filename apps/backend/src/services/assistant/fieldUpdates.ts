import {
  isEntityRef,
  type ActionDefinition,
  type EntityRef,
  type FieldUpdate,
  type FieldValue,
} from '@xyne/shared/assistant';
import type { FieldWords } from './fields';
import { matchFound, normalizeName, type RecordFinder, type SearchHints } from './records';

/**
 * Turns the words read from a request into engine updates: text as it was said, a choice
 * by its option id, and names as the records they match. `clear` says whether the request
 * itself was clear; a record also has to match exactly for the value to count as certain.
 *
 * Searches (conversations) run last, narrowed by the people and channels named with them,
 * now or earlier in the request (`known`): "the one with Meera" narrows "release notes".
 */
export async function toFieldUpdates(
  action: ActionDefinition,
  words: FieldWords,
  finder: RecordFinder,
  clear: boolean,
  known: Readonly<Record<string, FieldValue>> = {}
): Promise<FieldUpdate[]> {
  const entries = Object.entries(words);
  const searches = entries.filter(([field]) => action.fields[field]?.kind === 'thread');
  const others = entries.filter(([field]) => action.fields[field]?.kind !== 'thread');

  const named = await Promise.all(
    others.map(([field, value]) => fieldUpdates(action, field, value, finder, clear))
  );
  const namedUpdates = named.flat().filter((update) => !repeatsFound(update, words));

  // A search narrowed by a person or channel waits until that name is settled.
  const filterOpen = namedUpdates.some(
    (update) => isSearchFilter(action, update.field) && update.op === 'open'
  );
  if (searches.length > 0 && filterOpen) {
    const later = searches.flatMap(([field, value]) =>
      (Array.isArray(value) ? value : [value])
        .map((said) => said.trim())
        .filter(Boolean)
        .map((said) => ({ field, op: 'later' as const, said }))
    );
    return [...namedUpdates, ...later];
  }

  const hints = searchHints(action, namedUpdates, known);
  const searched = await Promise.all(
    searches.map(([field, value]) => fieldUpdates(action, field, value, finder, clear, hints))
  );
  return [...namedUpdates, ...searched.flat()];
}

/**
 * A name that matched nothing but contains another detail's words is that detail said twice:
 * with the channel “ios”, “the one in the ios” is no person to look for.
 */
function repeatsFound(update: FieldUpdate, words: FieldWords): boolean {
  if (update.op !== 'open' || update.options.length > 0) return false;
  const said = ` ${normalizeName(update.said)} `;
  return Object.entries(words).some(
    ([field, value]) =>
      field !== update.field &&
      [value].flat().some((other) => said.includes(` ${normalizeName(other)} `))
  );
}

async function fieldUpdates(
  action: ActionDefinition,
  field: string,
  value: string | string[],
  finder: RecordFinder,
  clear: boolean,
  hints?: SearchHints
): Promise<FieldUpdate[]> {
  const definition = action.fields[field];
  if (!definition) return [];
  const said = (Array.isArray(value) ? value : [value]).map((word) => word.trim()).filter(Boolean);

  if (definition.kind === 'text') {
    const [text] = said;
    return text ? [{ field, op: 'set', value: text, certain: clear }] : [];
  }
  if (definition.kind === 'choice') {
    const option = definition.options?.find((choice) =>
      said.some((word) => word.toLowerCase() === choice.id.toLowerCase())
    );
    return option ? [{ field, op: 'set', value: option.id, certain: clear }] : [];
  }

  // Every other kind is a record found by name or by search (person, channel, conversation).
  const kind = definition.kind;
  const mentions = definition.many ? said : said.slice(0, 1);
  return Promise.all(
    mentions.map(async (mention): Promise<FieldUpdate> => {
      const match = matchFound(kind, mention, await finder.find(kind, mention, hints));
      switch (match.kind) {
        case 'one':
          return definition.many
            ? { field, op: 'add', value: match.record, certain: clear && match.certain }
            : { field, op: 'set', value: match.record, certain: clear && match.certain };
        case 'several':
          return { field, op: 'open', said: mention, options: match.candidates };
        case 'none':
          return { field, op: 'open', said: mention, options: [] };
      }
    })
  );
}

/** The people and channels found now or earlier in the request. */
function searchHints(
  action: ActionDefinition,
  updates: readonly FieldUpdate[],
  known: Readonly<Record<string, FieldValue>>
): SearchHints {
  // Build the effective filter state by field. A new value for a single channel replaces the
  // old one; people fields marked `many` keep earlier people when another is added.
  const values = new Map<string, EntityRef[]>();
  for (const [field, value] of Object.entries(known)) {
    if (isSearchFilter(action, field)) values.set(field, entityRefs(value));
  }

  for (const update of updates) {
    if (!isSearchFilter(action, update.field)) continue;
    const current = values.get(update.field) ?? [];
    switch (update.op) {
      case 'set':
        values.set(update.field, isEntityRef(update.value) ? [update.value] : []);
        break;
      case 'add':
        values.set(
          update.field,
          current.some((ref) => ref.id === update.value.id) ? current : [...current, update.value]
        );
        break;
      case 'remove':
        values.set(
          update.field,
          current.filter((ref) => ref.id !== update.id)
        );
        break;
      case 'open':
        // Do not let an old value silently stand in for a correction the user is making.
        values.delete(update.field);
        break;
      case 'later':
        break;
    }
  }

  const refs = [...values.values()].flat();
  return {
    people: refs.filter((ref) => ref.kind === 'person').map((ref) => ref.id),
    channels: refs.filter((ref) => ref.kind === 'channel').map((ref) => ref.id),
  };
}

function isSearchFilter(action: ActionDefinition, field: string): boolean {
  return action.fields[field]?.searchFilter === true;
}

function entityRefs(value: FieldValue): EntityRef[] {
  return Array.isArray(value) ? value.filter(isEntityRef) : isEntityRef(value) ? [value] : [];
}
