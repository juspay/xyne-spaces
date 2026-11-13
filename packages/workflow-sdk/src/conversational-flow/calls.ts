/**
 * Reading a call — the step a frame makes on the way in, whose answer everything
 * inside that frame can quote.
 */
import { asArray, asRec, str, type Rec, type Step } from './json.js';
import type { Call, CallScope, DeclaredField } from './types.js';

/**
 * How deep and how wide a declared answer is described.
 *
 * Both were hit by a real payload: a ride lookup with 51 top-level keys wanted
 * 79 quotable leaves and got 60, silently dropping `rideStatus`, `vehicleNo`
 * and `tripCategory.tag` — fields an author had named and then could not find.
 * Depth 3 was equally tight: `customerDropLocation.address.city` is already at
 * the limit.
 *
 * A bigger number is not a real answer to an enormous response — it moves the
 * cliff rather than removing it, and 200 fields is more than a picker can show
 * usefully. The honest fix is to describe fields on demand instead of all at
 * once; until then these are sized for the APIs this actually meets.
 *
 * Depth restarts inside a list's items, so an item may be described this deep
 * again — which is what `price.value.amount` needs.
 */
const MAX_DEPTH = 6;
const MAX_FIELDS = 200;

export function readCall(step: Step, scope: CallScope, onFail: string | undefined): Call {
  const config = asRec(step.config);
  return {
    id: step.id,
    scope,
    title: str(step.title) ?? humanise(step.id),
    method: str(config['method']) ?? 'GET',
    url: str(config['url']) ?? '',
    request: config,
    credentialName: str(config['credentialName']),
    fields: declaredFields(asRec(config['response'])['bodySchema']),
    onFail,
  };
}

/**
 * The answer's fields, from the JSON Schema its author declared — written the
 * way they are quoted, relative to the body.
 */
/**
 * The leaves of a declared shape, as dotted paths — what a JSON Schema says you
 * can quote. The same walk serves a lookup's answer and what the conversation is
 * started with, because they are the same promise: these names will be there.
 */
export function declaredFields(schema: unknown): DeclaredField[] {
  const out: DeclaredField[] = [];
  const descend = (node: unknown, path: string, depth: number): void => {
    if (out.length >= MAX_FIELDS) return;
    const rec = asRec(node);
    const properties = asRec(rec['properties']);
    const keys = Object.keys(properties);
    if (keys.length === 0 || depth >= MAX_DEPTH) {
      if (path) out.push({ path, type: str(rec['type']), ...itemsOf(rec) });
      return;
    }
    for (const key of keys) descend(properties[key], path ? `${path}.${key}` : key, depth + 1);
  };
  descend(schema, '', 0);
  return out;
}

/**
 * A list's item fields, when its items are objects that declare any.
 *
 * The list itself stays a leaf — `items` is not a step on a quotable path, and
 * nothing may point at one element of it. What this adds is the vocabulary for
 * saying something *about* the items, which is what filtering and totalling a
 * list both need. The same `declaredFields` walk describes an item, so a list of
 * objects of objects reads the same way one level down.
 *
 * Returned as a spreadable fragment so the key is simply absent when there is
 * nothing to say, which `exactOptionalPropertyTypes` requires.
 */
function itemsOf(node: Rec): { itemFields?: DeclaredField[] } {
  if (str(node['type']) !== 'array') return {};
  const fields = declaredFields(asRec(node['items']));
  return fields.length > 0 ? { itemFields: fields } : {};
}

/** `fetch_refund` → `Fetch refund`, for a call whose author never named it. */
function humanise(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

/** Whatever `steps` quote of a call's answer, so nothing is removed silently. */
export function quotedBy(steps: unknown, callId: string): boolean {
  return JSON.stringify(asArray(steps)).includes(`steps.${callId}.`);
}

