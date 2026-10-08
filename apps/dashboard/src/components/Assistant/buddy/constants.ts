/** Marks the Xyne AI panel, so Buddy never uses its own controls. */
export const ASSISTANT_PANEL_ATTR = 'data-assistant-panel';

/** Buddy acts only when Jev gives its pick at least this probability; below it, Ask AI answers. */
export const MIN_PROBABILITY = 0.5;

/** These open the Xyne AI panel Buddy itself runs in, so Buddy never offers them. */
export const OWN_PANEL_TRACKS: ReadonlySet<string> = new Set([
  'OPEN_XYNE_AI',
  'OPEN_XYNE_AI_FROM_THREAD',
  'OPEN_XYNE_AI_MOBILE',
]);

export const LIMITS = {
  controls: 200,
  textLength: 60,
  labelLength: 300,
} as const;

export const TIMING = {
  showBeforeClickMs: 350,
  pointMs: 6_000,
  settleQuietMs: 250,
  settleMaxMs: 2_500,
} as const;

/** A workspace id at the start of a link, which only adds noise to what Jev reads. */
export const WORKSPACE_PREFIX = /^\/[a-z0-9]{20,}(?=\/|$)/;

export const SELECTORS = {
  tracked: '[data-track-name]',
  hidden: `[${ASSISTANT_PANEL_ATTR}], [aria-hidden="true"], [inert]`,
  openDialog:
    '[role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"], [role="alertdialog"]',
  /** Menus, popovers and lists that float over the page without being a dialog. */
  popup: '[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"]',
  form: 'form, [role="dialog"], [role="alertdialog"]',
  row: 'tr, li, [role="row"], [role="listitem"]',
} as const;

/** These change data or reach other people, so Buddy points at them instead of clicking. */
export const CHANGES_DATA =
  /\b(send|delete|remove|archive|leave|end|log ?out|sign ?out|deactivate|revoke|disconnect|reject|decline|approve|merge|reset|ban|kick|block|unsubscribe|publish|post|invite|resolve|pay|admin|role|access|grant|permission|promote|demote|transfer|clear|discard|disable|wipe|yes|dial|(?:start|stop)(?: \w+)? (?:record|recording|call|huddle|meeting)|join (?:the )?(?:call|huddle|meeting))\b/;
/** Opening a menu or panel changes nothing, whatever it is about. */
export const OPENS_UI = /\b(open|trigger|menu|dropdown|tab|expand|collapse)$/;
/** These finish the form or dialog they sit in. */
export const FINISHES_FORM = /^(create|save|submit|confirm|add|update|apply|done|continue)\b/;

export const HIGHLIGHT = { padding: 4, layer: '2147483000' } as const;

export const MESSAGES = {
  opened: (what: string): string => `Opened ${what}.`,
  done: (what: string): string => `Done: ${what}.`,
  alreadyOpen: (what: string): string => `Already open: ${what}.`,
  pointAt: (what: string): string => `Here's ${what}. I've highlighted it so you can finish.`,
  whichOne: (a: string, b: string): string => `Did you mean ${a} or ${b}?`,
} as const;
