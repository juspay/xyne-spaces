import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { highlightText } from '@/vespa/src/utils/highlight';
import { displayFieldLoader, resolvedChannelNames, type DisplayFields } from './displayFields';

/**
 * When Vespa holds hashed values (the encryption gateway hashes text fields and stores no plaintext), the hits a
 * search returns carry hashes in place of text, titles and names. Hashes cannot be reversed, so each hit is refilled
 * from Postgres (displayFields.ts: read-only, one query per table for all the hits of a schema) with the values the
 * Vespa mapper indexed. Only display fields are replaced; ids, scores and match features are left as they are.
 *
 * Vespa's own highlighting (`bolding: on`) wraps matched hashes in <hi>. The gateway stores one hash per word, in
 * order, so the n-th hash is the n-th word of the plaintext: the words Vespa marked are marked again on the plaintext,
 * which reproduces Vespa's highlighting (stemmed matches included). If the word counts differ, the backend's own
 * highlighter is used instead.
 *
 * On by default (VESPA_HYDRATE_RESULTS_FROM_DB); set it to false for a plaintext Vespa, which needs no extra database reads.
 */

// Imported channel names are not part of the hit's own document: Vespa reads them from the chat_container document at
// query time (`import field channelRef.channelName as channelName`), so they are refilled with that document's channel
// name. The channel's id comes back in plaintext (ids are not hashed).
const IMPORTED_CHANNEL_NAME = new Set(['chat_message', 'chat_attachment', 'mail']);

// Fields of `lean` that `hydrate` leaves out (hashed and not bolded): with that summary they are added from Postgres
// so the hit has lean's shape. Keep in step with vespa-core-1's `document-summary hydrate` blocks.
const ADDED_WITH_HYDRATE_SUMMARY: Record<string, string[]> = {
  app: ['name', 'description', 'creatorName', 'creatorEmail', 'orgName'],
  call: ['roomLink', 'title', 'displayTitle', 'channelName', 'participantNames', 'participantEmails'],
  chat_attachment: ['filename', 'channelName'],
  chat_container: ['channelName', 'description', 'topic', 'entityTypeDefs'],
  chat_message: ['username', 'threadSenders', 'links', 'channelName'],
  file: ['description', 'urlOriginal', 'urlInternal'],
  mail: ['from', 'to', 'ticketFormFields', 'channelName'],
  mail_attachment: ['filename'],
  memory: ['userQuery'],
  project: ['name', 'description'],
  sam_transcript: ['meetCode', 'meetingSummary'],
  sdlc_container: ['name', 'description', 'repoName', 'repoUrl', 'path'],
  sdlc_repository: ['name', 'url'],
  ticket: ['description', 'xyneId', 'assignedTo', 'threadSenders', 'formFields', 'channelName'],
  user: ['name', 'email'],
};

type Hit = { id?: string; fields?: Record<string, unknown>; children?: Hit[] };

/** Every document hit in a (possibly grouped) response, in place. */
function collectHits(node: Hit | Hit[] | undefined, out: Hit[]): Hit[] {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collectHits(n, out));
    return out;
  }
  const id = node.id ?? '';
  if (node.fields?.docId !== undefined && !id.startsWith('group')) out.push(node);
  if (node.children) collectHits(node.children, out);
  return out;
}

/** `id:<namespace>:<schema>::<docId>` -> schema. */
function schemaOf(hit: Hit): string | undefined {
  const m = /^id:[^:]+:([^:]+)::/.exec(hit.id ?? '');
  return m?.[1] ?? (hit.fields?.sddocname as string | undefined);
}

const hasHighlight = (v: unknown): boolean =>
  typeof v === 'string' ? v.includes('<hi>') : Array.isArray(v) && v.some(hasHighlight);

// A word as Vespa's tokenizer sees it: a run of letters and digits (punctuation and spaces separate words).
const WORD = /[\p{L}\p{N}]+/gu;

/** Mark on `plain` the words whose hashes Vespa marked in `hashed`; null when the word counts do not line up. */
function markLikeVespa(plain: string, hashed: string): string | null {
  const marked = hashed.split(/\s+/).filter(Boolean).map((t) => t.includes('<hi>'));
  const words = [...plain.matchAll(WORD)];
  if (words.length !== marked.length) return null;
  let out = '', last = 0;
  words.forEach((w, i) => {
    const start = w.index ?? 0, end = start + w[0].length;
    out += plain.slice(last, start) + (marked[i] ? `<hi>${w[0]}</hi>` : w[0]);
    last = end;
  });
  return out + plain.slice(last);
}

const highlight = (plain: unknown, hashed: unknown, query: string, mentionNames: string[]): unknown => {
  if (typeof plain === 'string')
    return (typeof hashed === 'string' && markLikeVespa(plain, hashed)) || highlightText(plain, query, mentionNames);
  if (Array.isArray(plain)) return plain.map((x, i) => highlight(x, Array.isArray(hashed) ? hashed[i] : undefined, query, mentionNames));
  return plain;
};

export async function hydrateHitsFromDb(
  response: unknown,
  options: { query?: string; mentionNames?: string[]; addMissing?: boolean } = {},
): Promise<void> {
  const root = (response as { root?: Hit } | undefined)?.root;
  if (!config.vespa.hydrateResultsFromDb || !root?.children) return;
  const hits = collectHits(root.children, []);
  if (hits.length === 0) return;

  const bySchema = new Map<string, Hit[]>();
  for (const hit of hits) {
    const schema = schemaOf(hit);
    if (schema && hit.fields) bySchema.set(schema, [...(bySchema.get(schema) ?? []), hit]);
  }

  // One load per schema for all its hits, plus one for the imported channel names; all read-only.
  const failures = new Map<string, number>();
  const loaded = new Map<string, Map<string, DisplayFields>>();
  const channelIds = [...new Set(hits.filter((h) => IMPORTED_CHANNEL_NAME.has(schemaOf(h) ?? ''))
    .map((h) => h.fields?.channelId).filter((id): id is string => typeof id === 'string' && id !== ''))];
  const [channelNames] = await Promise.all([
    resolvedChannelNames(channelIds).catch(() => {
      failures.set('channelName', channelIds.length);
      return new Map<string, string>();
    }),
    ...[...bySchema].map(async ([schema, schemaHits]) => {
      const load = displayFieldLoader(schema);
      if (!load) return;   // no Postgres source (memory, sam_transcript, ...): the hits keep their hashed values
      try {
        loaded.set(schema, await load(schemaHits.map((h) => h.fields!)));
      } catch {
        failures.set(schema, schemaHits.length);
      }
    }),
  ]);

  for (const [schema, schemaHits] of bySchema) {
    const docs = loaded.get(schema);
    const added = options.addMissing ? ADDED_WITH_HYDRATE_SUMMARY[schema] ?? [] : [];
    let missing = 0;
    for (const hit of schemaHits) {
      const fields = hit.fields!;
      const doc: DisplayFields = { ...(docs?.get(String(fields.docId)) ?? {}) };
      if (docs && !docs.has(String(fields.docId))) missing++;   // deleted since it was indexed
      if (IMPORTED_CHANNEL_NAME.has(schema) && typeof fields.channelId === 'string' && channelNames.has(fields.channelId)) {
        doc.channelName = channelNames.get(fields.channelId);
      }
      for (const [name, value] of Object.entries(doc)) {
        if (value === undefined) continue;
        if (name in fields) {                                     // a field the hit came back with
          fields[name] = hasHighlight(fields[name]) && options.query
            ? highlight(value, fields[name], options.query, options.mentionNames ?? [])
            : value;
        } else if (added.includes(name)) {                        // a field the slim summary left out
          fields[name] = value;
        }
      }
    }
    if (missing > 0) failures.set(schema, (failures.get(schema) ?? 0) + missing);
  }

  if (failures.size > 0) {
    // Schema and count only: values and ids of the documents are not logged.
    logger.warn(`[hydrateHitsFromDb] ${hits.length} hits, not refilled: ${JSON.stringify(Object.fromEntries(failures))}`);
  }
}
