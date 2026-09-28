import {
  isEntityRef,
  type ActionDefinition,
  type EntityRef,
  type FieldUpdate,
  type FieldValue,
} from '@xyne/shared/assistant';
import type { FieldWords } from './fields';
import { matchFound, type RecordFinder, type SearchHints } from './records';

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
  const hints = searchHints(named.flat(), known);
  const searched = await Promise.all(
    searches.map(([field, value]) => fieldUpdates(action, field, value, finder, clear, hints))
  );
  return [...named.flat(), ...searched.flat()];
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
          return { field, op: 'ambiguous', mention, candidates: match.candidates };
        case 'none':
          return { field, op: 'unknown', mention };
      }
    })
  );
}

/** The people and channels found now or earlier in the request. */
function searchHints(
  updates: readonly FieldUpdate[],
  known: Readonly<Record<string, FieldValue>>
): SearchHints {
  const refs: EntityRef[] = [
    ...updates.flatMap((update) =>
      (update.op === 'set' || update.op === 'add') && isEntityRef(update.value)
        ? [update.value]
        : []
    ),
    ...Object.values(known).flatMap((value) =>
      Array.isArray(value) ? value : isEntityRef(value) ? [value] : []
    ),
  ];
  return {
    people: refs.filter((ref) => ref.kind === 'person').map((ref) => ref.id),
    channels: refs.filter((ref) => ref.kind === 'channel').map((ref) => ref.id),
  };
}
