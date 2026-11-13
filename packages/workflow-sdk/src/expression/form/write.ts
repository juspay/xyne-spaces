/**
 * A computation as expression text.
 *
 * Paired with `read.ts`, which must recognise exactly what this produces — a
 * writer and a reader that drift leave an author unable to re-open what they
 * built. The round-trip test covers both.
 */
import { expressionFunction } from '../catalogue.js';
import { EXPRESSION_ROOTS } from '../format.js';
import { elementType, writeLiteralAs, type ExprType } from '../types.js';
import {
  ITEM,
  PLACEHOLDER,
  argumentSlots,
  wantsAt,
  type Argument,
  type Call,
  type Computation,
  type ListFormat,
  type ValueSelection,
} from './model.js';

/** A literal for inside a predicate, typed from what the author typed. */
export function writeLiteral(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') return trimmed;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return trimmed;
  return JSON.stringify(raw);
}

/** One selection as expression text: the list, narrowed, then read. */
export function writeSelection(selection: ValueSelection): string {
  if (selection.path === '') return '';
  const filter = selection.filter;
  const narrowed =
    filter && filter.field !== '' && filter.value !== ''
      ? `[${filter.field} ${filter.op} ${
          (filter.type === undefined ? null : writeLiteralAs(filter.value, filter.type)) ??
          writeLiteral(filter.value)
        }]`
      : '';
  const read = selection.field ? `.${selection.field}` : '';
  return `${selection.path}${narrowed}${read}`;
}


/** The expression a computation describes, or null when it is not yet complete. */
export function writeComputation(computation: Computation): string | null {
  return computation.kind === 'list' ? writeList(computation) : writeCall(computation);
}




/** One argument as JSONata, or `null` when it cannot be written at all. */
function writeArgument(argument: Argument, want: ExprType): string | null {
  if (argument.kind === 'fixed') return writeLiteralAs(argument.raw, want);
  if (argument.kind === 'list') {
    // Each entry is one element of the list it is building.
    const entries = argument.of.map((entry) => writeArgument(entry, elementType(want)));
    const kept = entries.filter((text): text is string => text !== null);
    return kept.length === 0 ? null : `[${kept.join(', ')}]`;
  }
  const written = writeSelection(argument);
  return written === '' ? null : written;
}

function writeCall(computation: Call): string | null {
  const entry = expressionFunction(computation.fn);
  const slots = argumentSlots(computation.fn);
  if (!entry || !slots) return null;

  const written: string[] = [];
  for (const [at, argument] of computation.args.entries()) {
    // Blank and unwritable are different answers. A trailing optional argument
    if (isBlank(argument)) {
      if (computation.args.slice(at + 1).some((a) => !isBlank(a))) return null;
      break;
    }
    const text = writeArgument(argument, wantsAt(computation.fn, at));
    if (text === null) return null;
    written.push(text);
  }
  if (written.length === 0) return null;

  // `-` means JSONata can supply it from the context, so it is not required of
  const required = entry.signature.params.filter((p) => !p.optional && !p.fromContext).length;
  if (written.length < required) return null;

  if (entry.infix !== undefined) {
    return written.length === 2 ? `${written[0]!} ${entry.infix} ${written[1]!}` : null;
  }
  return `${computation.fn}(${written.join(', ')})`;
}

/** Nothing said yet — a control still empty. */
function isBlank(argument: Argument): boolean {
  if (argument.kind === 'fixed') return argument.raw.trim() === '';
  if (argument.kind === 'list') return argument.of.every(isBlank);
  return argument.path === '';
}



/** What one `{{…}}` reads, as JSONata. */
function readsAs(path: string): string {
  const root = path.split('.')[0] ?? '';
  const outer = (EXPRESSION_ROOTS as readonly string[]).includes(root);
  return `$string(${outer ? path : `${ITEM}.${path}`})`;
}

/** A template as a JSONata concatenation, with the literals quoted. */
function writeTemplate(template: string): string | null {
  // Always quoted as text: `writeLiteral` would turn the fragment "10" into a
  const quote = (text: string) => JSON.stringify(text);
  const parts: string[] = [];
  let at = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const path = match[1]?.trim() ?? '';
    // `{{ }}` names nothing. It cannot be a placeholder, and it cannot be kept
    if (path === '') return null;
    if (match.index > at) parts.push(quote(template.slice(at, match.index)));
    parts.push(readsAs(path));
    at = match.index + match[0].length;
  }
  if (at < template.length) parts.push(quote(template.slice(at)));
  return parts.length === 0 ? null : parts.join(' & ');
}

function writeList(computation: ListFormat): string | null {
  const source = writeSelection(computation.source);
  const body = writeTemplate(computation.template);
  if (source === '' || body === null) return null;

  const listed = `$join($map(${source}, function(${ITEM}){ ${body} }), ${JSON.stringify(
    computation.separator,
  )})`;

  // Guarded only when the author said what to show instead; otherwise an empty
  return computation.empty === undefined
    ? listed
    : `$count(${source}) = 0 ? ${JSON.stringify(computation.empty)} : ${listed}`;
}
