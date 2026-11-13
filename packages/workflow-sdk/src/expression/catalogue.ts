/**
 * The operations a menu offers: a name, how to say it in plain language, and
 * the signature JSONata declares for it.
 *
 * `offer` is editorial — which kind of field an entry is *offered* for — and
 * may only narrow a menu, never refuse an expression. Checking is `signature`'s
 * job alone, and a test asserts the containment.
 *
 * No `jsonata` import: data plus a string parser.
 */
import { builtinSignature } from './signatures.js';
import { paramAt, parseSignature, type Signature } from './signature.js';
import type { TypeKind } from '../util/type-compat.js';
import type { ExprType } from './types.js';

export interface ExpressionFunction {
  /** Call name, including the `$`. */
  name: string;
  /** Menu label — plain language, for an author who does not write code. */
  label: string;
  /** One line of help, shown under the label. */
  help: string;
  /** Which kind of field this is *offered* for — editorial, not a type. */
  offer: TypeKind;
  /**
   * JSONata's own signature, read from the generated table rather than restated
   * here. `signature.returns` is what it gives back; `paramAt(signature, n)` is
   * what its nth argument takes. The only thing checking consults.
   */
  signature: Signature;
  /**
   * A complete call with `…` where the author's value goes, and plausible text in the other arguments — `$replace(…, "old", "new")`.
   */
  template: string;
  /** The operator this is written with, for the handful that are not functions. */
  infix?: string;
  /**
   * A signature for an entry JSONata has none for, in its own notation so there
   * is one parser and one meaning. Ignored when the name is a real builtin.
   */
  declared?: string;
}

/**
 * Ordered for display: the arithmetic an author came here for first, then text,
 * then lists, then the few object and true/false helpers.
 */

/** What a person needs; the types are joined on below. */
type Described = Omit<ExpressionFunction, 'signature'>;

/** Arithmetic, which JSONata writes as operators rather than functions. */
const ARITHMETIC: readonly Described[] = [
  { name: 'add',      infix: '+', declared: '<nn:n>', offer: 'number', label: 'Add',       help: 'Add two numbers together.',        template: '… + …' },
  { name: 'subtract', infix: '-', declared: '<nn:n>', offer: 'number', label: 'Subtract',  help: 'Take one number off another.',     template: '… - …' },
  { name: 'multiply', infix: '*', declared: '<nn:n>', offer: 'number', label: 'Multiply',  help: 'Multiply two numbers.',            template: '… * …' },
  { name: 'divide',   infix: '/', declared: '<nn:n>', offer: 'number', label: 'Divide',    help: 'Divide one number by another.',    template: '… / …' },
  { name: 'remainder', infix: '%', declared: '<nn:n>', offer: 'number', label: 'Remainder', help: 'What is left over after dividing.', template: '… % …' },
];

const DESCRIBED: readonly Described[] = [
  // ── Numbers ──
  { name: '$sum',     offer: 'number', label: 'Sum',          help: 'Add up a list of numbers.',   template: '$sum(…)' },
  { name: '$count',   offer: 'number', label: 'Count',        help: 'How many items are in a list.',   template: '$count(…)' },
  { name: '$average', offer: 'number', label: 'Average',      help: 'The mean of a list of numbers.',   template: '$average(…)' },
  { name: '$max',     offer: 'number', label: 'Largest',      help: 'The biggest number in a list.',   template: '$max(…)' },
  { name: '$min',     offer: 'number', label: 'Smallest',     help: 'The smallest number in a list.',   template: '$min(…)' },
  { name: '$round',   offer: 'number', label: 'Round',        help: 'Round to a number of decimal places.',  template: '$round(…, 2)' },
  { name: '$floor',   offer: 'number', label: 'Round down',   help: 'Round down to a whole number.',  template: '$floor(…)' },
  { name: '$ceil',    offer: 'number', label: 'Round up',     help: 'Round up to a whole number.',  template: '$ceil(…)' },
  { name: '$abs',     offer: 'number', label: 'Absolute',     help: 'Drop the minus sign.',  template: '$abs(…)' },
  // Really `string | number`, which this vocabulary cannot say — so `unknown`,
  { name: '$number',  offer: 'number', label: 'As a number',  help: 'Read text as a number.', template: '$number(…)' },
  { name: '$length',  offer: 'number', label: 'Length',       help: 'How many characters are in some text.',  template: '$length(…)' },

  // ── Text ──
  { name: '$uppercase', offer: 'string', label: 'UPPERCASE',  help: 'Put text in capitals.',  template: '$uppercase(…)' },
  { name: '$lowercase', offer: 'string', label: 'lowercase',  help: 'Put text in lower case.',  template: '$lowercase(…)' },
  { name: '$trim',      offer: 'string', label: 'Trim',       help: 'Remove spaces from both ends.',  template: '$trim(…)' },
  { name: '$join',      offer: 'string', label: 'Join',       help: 'Join a list into one piece of text.',     template: '$join(…, ", ")' },
  { name: '$replace',   offer: 'string', label: 'Replace',    help: 'Swap one piece of text for another.',  template: '$replace(…, "old", "new")' },
  { name: '$string',    offer: 'string', label: 'As text',    help: 'Turn any value into text.', template: '$string(…)' },

  // ── Lists ──
  { name: '$filter',   offer: 'array', label: 'Keep only',   help: 'Keep the items that match a test.',   template: '$filter(…, function($item){ $item.amount > 0 })' },
  { name: '$map',      offer: 'array', label: 'For each',    help: 'Work out a value for every item.',   template: '$map(…, function($item){ $item.amount })' },
  { name: '$sort',     offer: 'array', label: 'Sort',        help: 'Put a list in order.',   template: '$sort(…)' },
  { name: '$reverse',  offer: 'array', label: 'Reverse',     help: 'Flip the order of a list.',   template: '$reverse(…)' },
  { name: '$distinct', offer: 'array', label: 'Unique',      help: 'Remove repeated items.',   template: '$distinct(…)' },
  { name: '$append',   offer: 'array', label: 'Add together',help: 'Join two lists into one.',   template: '$append(…, …)' },
  { name: '$split',    offer: 'array', label: 'Split',       help: 'Break text into a list.',  template: '$split(…, ", ")' },

  // ── Objects ──
  { name: '$keys',   offer: 'array', label: 'Field names',   help: 'The names of the fields on an object.',  template: '$keys(…)' },
  { name: '$lookup', offer: 'unknown', label: 'Field value',   help: 'Read one named field from an object.',  template: '$lookup(…, "field")' },
  { name: '$merge',  offer: 'object', label: 'Merge',         help: 'Combine a list of objects into one.',   template: '$merge(…)' },

  // ── True / false ──
  { name: '$exists',   offer: 'boolean', label: 'Has a value', help: 'True when something is present.', template: '$exists(…)' },
  { name: '$contains', offer: 'boolean', label: 'Contains',    help: 'True when text contains other text.',  template: '$contains(…, "text")' },
  { name: '$not',      offer: 'boolean', label: 'Not',         help: 'Flip true to false and back.', template: '$not(…)' },
];


/** A signature that checks nothing, for a name the table does not describe. */
const UNCHECKED: Signature = { params: [], returns: 'unknown' };

export const EXPRESSION_FUNCTIONS: readonly ExpressionFunction[] = [
  ...ARITHMETIC,
  ...DESCRIBED,
].map((entry) => {
  // A real builtin's own signature wins; `declared` covers the operators, which
  const definition = builtinSignature(entry.name) ?? entry.declared;
  const signature = definition === undefined ? null : parseSignature(definition);
  return { ...entry, signature: signature ?? UNCHECKED };
});

/** What this function's first argument takes — what a picker should offer. */
export function takesOf(fn: ExpressionFunction): ExprType {
  return paramAt(fn.signature, 0)?.type ?? 'unknown';
}

/** Look one up by call name (with or without the leading `$`). */
export function expressionFunction(name: string): ExpressionFunction | undefined {
  const direct = EXPRESSION_FUNCTIONS.find((fn) => fn.name === name);
  if (direct) return direct;
  const withSigil = name.startsWith('$') ? name : `$${name}`;
  return EXPRESSION_FUNCTIONS.find((fn) => fn.name === withSigil);
}
