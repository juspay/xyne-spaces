import type { ActionDefinition, FieldUpdate } from '@xyne/shared/assistant';
import type { FieldWords } from './details';
import { matchName, type RecordFinder } from './records';

/**
 * Turns the words read from a request into engine updates: text as it was said, a choice
 * by its option id, and names as the records they match. `clear` says whether the request
 * itself was clear; a record also has to match exactly for the value to count as certain.
 */
export async function toFieldUpdates(
  action: ActionDefinition,
  words: FieldWords,
  finder: RecordFinder,
  clear: boolean,
): Promise<FieldUpdate[]> {
  const perField = await Promise.all(
    Object.entries(words).map(async ([field, value]): Promise<FieldUpdate[]> => {
      const definition = action.fields[field];
      if (!definition) return [];
      const said = (Array.isArray(value) ? value : [value]).map(word => word.trim()).filter(Boolean);

      if (definition.kind === 'text') {
        const [text] = said;
        return text ? [{ field, op: 'set', value: text, certain: clear }] : [];
      }
      if (definition.kind === 'choice') {
        const option = definition.options?.find(
          choice => said.some(word => word.toLowerCase() === choice.id.toLowerCase()),
        );
        return option ? [{ field, op: 'set', value: option.id, certain: clear }] : [];
      }

      // Every other kind is a record found by name (person, channel, …).
      const kind = definition.kind;
      const mentions = definition.many ? said : said.slice(0, 1);
      return Promise.all(
        mentions.map(async (mention): Promise<FieldUpdate> => {
          const match = matchName(mention, await finder.find(kind, mention));
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
        }),
      );
    }),
  );
  return perField.flat();
}
