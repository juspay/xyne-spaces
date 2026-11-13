/**
 * What survives once `{{…}}` references are stripped from a config.
 *
 * Mirrors the runtime rule exactly. Every key is optional at every depth,
 * because a reference removes it — so absence means "not knowable here",
 * whether the field holds a reference or was simply never set. A loader
 * narrowing a list and a validator checking one both do the same thing with
 * those two cases, so collapsing them is right rather than lossy.
 *
 * Arrays stay whole rather than going element-wise partial: a list holding a
 * reference is unanswerable, not shorter.
 *
 * Authors never name this. It is applied inside the context types, so the shape
 * falls out of the config schema they already wrote.
 */
export type Literal<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? Literal<T[K]>
      : T[K];
};
