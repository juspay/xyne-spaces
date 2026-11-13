/**
 * Every JSONata builtin, with the signature JSONata itself declares for it.
 *
 * **Generated, not written.** The names come from `staticFrame.bind('…')` in the
 * installed `jsonata`, and each signature from evaluating `$name` — a builtin
 * resolves to an object carrying `signature.definition`. `jsonata-signatures.test.ts`
 * re-derives this table from the installed package and fails if it has drifted,
 * so an upgrade cannot silently leave it stale.
 *
 * ## Why this is here at all
 *
 * The alternative was writing the types out by hand, and that was tried first:
 * it put `object` on `$keys`, `array` on `$distinct` and `array` on `$append`,
 * all three of which really take anything — so correct expressions were refused.
 * A type checker that is wrong is worse than none, and the only defence is to
 * take the types from the language rather than restate them.
 *
 * It also buys reach: every one of these is typed, not the twenty-odd a curated
 * list would cover, and a name absent from this table is a name JSONata does not
 * have — which is how a typo gets caught.
 *
 * ## Why generated rather than read at run time
 *
 * JSONata does expose these through its public API — `jsonata('$sum')
 * .evaluate({})` resolves to the builtin object and carries
 * `signature.definition`, no internals involved. The reason not to is that
 * `evaluate` is **async**, and the catalogue it would feed is consulted
 * synchronously while a menu renders. Reading them live would make building the
 * catalogue async, or need a top-level await, to learn facts that are fixed for
 * a given version of the dependency.
 *
 * So the table is a build-time snapshot of a run-time truth, and the drift test
 * is what makes that safe: it takes the same public route on every run and
 * fails if the two have parted. The one thing it reaches into the package for
 * is the *list of names* — there is no public enumeration — and that stays in
 * the test, never in what ships.
 *
 * Signatures are JSONata's own notation; `signature.ts` reads it.
 */
export const BUILTIN_SIGNATURES: Readonly<Record<string, string>> = {
  abs:                '<n-:n>',
  append:             '<xx:a>',
  assert:             '<bs?:x>',
  average:            '<a<n>:n>',
  base64decode:       '<s-:s>',
  base64encode:       '<s-:s>',
  boolean:            '<x-:b>',
  ceil:               '<n-:n>',
  clone:              '<(oa)-:o>',
  contains:           '<s-(sf):b>',
  count:              '<a:n>',
  decodeUrl:          '<s-:s>',
  decodeUrlComponent: '<s-:s>',
  distinct:           '<x:x>',
  each:               '<o-f:a>',
  encodeUrl:          '<s-:s>',
  encodeUrlComponent: '<s-:s>',
  error:              '<s?:x>',
  eval:               '<sx?:x>',
  exists:             '<x:b>',
  filter:             '<af>',
  floor:              '<n-:n>',
  formatBase:         '<n-n?:s>',
  formatInteger:      '<n-s:s>',
  formatNumber:       '<n-so?:s>',
  fromMillis:         '<n-s?s?:s>',
  join:               '<a<s>s?:s>',
  keys:               '<x-:a<s>>',
  length:             '<s-:n>',
  lookup:             '<x-s:x>',
  lowercase:          '<s-:s>',
  map:                '<af>',
  match:              '<s-f<s:o>n?:a<o>>',
  max:                '<a<n>:n>',
  merge:              '<a<o>:o>',
  min:                '<a<n>:n>',
  not:                '<x-:b>',
  number:             '<(nsb)-:n>',
  pad:                '<s-ns?:s>',
  parseInteger:       '<s-s:n>',
  power:              '<n-n:n>',
  random:             '<:n>',
  reduce:             '<afj?:j>',
  replace:            '<s-(sf)(sf)n?:s>',
  reverse:            '<a:a>',
  round:              '<n-n?:n>',
  shuffle:            '<a:a>',
  sift:               '<o-f?:o>',
  single:             '<af?>',
  sort:               '<af?:a>',
  split:              '<s-(sf)n?:a<s>>',
  spread:             '<x-:a<o>>',
  sqrt:               '<n-:n>',
  string:             '<x-b?:s>',
  substring:          '<s-nn?:s>',
  substringAfter:     '<s-s:s>',
  substringBefore:    '<s-s:s>',
  sum:                '<a<n>:n>',
  toMillis:           '<s-s?:n>',
  trim:               '<s-:s>',
  type:               '<x:s>',
  uppercase:          '<s-:s>',
  zip:                '<a+>',
};

/** True when JSONata has a builtin by this name (with or without the `$`). */
export function isBuiltin(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    BUILTIN_SIGNATURES,
    name.startsWith('$') ? name.slice(1) : name,
  );
}

/** JSONata's declared signature for a builtin, or undefined when it has none. */
export function builtinSignature(name: string): string | undefined {
  return BUILTIN_SIGNATURES[name.startsWith('$') ? name.slice(1) : name];
}
