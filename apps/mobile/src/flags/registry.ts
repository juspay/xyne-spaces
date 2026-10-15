/**
 * Every feature flag in the app.
 *
 * Each flag is a boolean with a removal date. `__tests__/flags.test.ts` fails
 * the build once `removeBy` passes, because good intentions do not delete flags
 * and a red build does. `git blame` says who to ask.
 */

/** A date the expiry test can compare. */
type IsoDate = `${number}-${number}-${number}`;

export type FlagDefinition = {
  /** Switch label on the Beta screen. */
  readonly label: string;
  /** Subtitle under the switch. Say what turning it on does. */
  readonly description: string;
  readonly default: boolean;
  readonly removeBy: IsoDate;
  /**
   * Parent flag. This one is forced off while the parent is off, whatever
   * storage holds. Checked against the registry in the flags test.
   */
  readonly requires?: string;
};

export const FLAGS = {
  'ui.shell': {
    label: 'New navigation',
    description: 'The new bottom bar in place of the swipeable pager.',
    default: false,
    removeBy: '2026-12-31',
  },
  'chat.v3': {
    label: 'Chat v3',
    description: 'The rewritten chat screens. Leave and reopen a conversation after changing this.',
    default: false,
    removeBy: '2026-12-31',
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAGS;

export type ResolvedFlags = Readonly<Record<FlagKey, boolean>>;

export const FLAG_KEYS = Object.keys(FLAGS) as readonly FlagKey[];

export function isFlagKey(value: string): value is FlagKey {
  return Object.prototype.hasOwnProperty.call(FLAGS, value);
}

/**
 * The flag this one depends on, or `undefined`.
 *
 * `as const satisfies` keeps the literal shape, so `requires` is simply absent
 * from flags that do not declare it and cannot be read off the union directly.
 * Widening once here keeps that cast out of every call site, and narrows the
 * result to a real key on the way out.
 */
export function parentFlag(key: FlagKey): FlagKey | undefined {
  const parent = (FLAGS[key] as FlagDefinition).requires;
  return parent !== undefined && isFlagKey(parent) ? parent : undefined;
}
