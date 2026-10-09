/** Marks the Xyne AI panel, so Buddy never uses its own controls. */
export const ASSISTANT_PANEL_ATTR = 'data-assistant-panel';

/** Buddy asks about Jev's pick from this probability; below it, Ask AI answers. */
export const MIN_PROBABILITY = 0.5;

/** Jev this sure the request is a question, not something to do: no point looking in menus. */
export const SURE_NONE = 0.9;

/** Buddy clicks only this sure; less sure, it highlights its pick and asks if that is it. */
export const SURE_CLICK = 0.85;

/** Pages a request may walk through, following the pages its clicks open. */
export const MAX_STEPS = 3;

/** These open the Xyne AI panel Buddy itself runs in, so Buddy never offers them. */
export const OWN_PANEL_TRACKS: ReadonlySet<string> = new Set([
  'OPEN_XYNE_AI',
  'OPEN_XYNE_AI_FROM_THREAD',
  'OPEN_XYNE_AI_MOBILE',
]);

export const LIMITS = {
  controls: 200,
  textLength: 60,
  labelLength: 600,
  /** Visible and hidden together, under the backend's 250. */
  options: 240,
  peeks: 3,
} as const;

/** Times, dates, counts and initials are content, not something to open. */
export const VOLATILE_TEXT =
  /^(\d+\+?|\p{L})$|\b\d{1,2}:\d{2}\b|\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.? \d{1,2}\b/iu;

export const TIMING = {
  showBeforeClickMs: 350,
  pointMs: 6_000,
  settleQuietMs: 250,
  settleMaxMs: 2_500,
} as const;

/** A workspace id at the start of a link, which only adds noise to what Jev reads. */
export const WORKSPACE_PREFIX = /^\/[a-z0-9]{20,}(?=\/|$)/;

export const SELECTORS = {
  /** Tracked controls, and the links and tabs a page marks as its navigation. */
  control: '[data-track-name], nav a[href], [role="tab"]',
  hidden: `[${ASSISTANT_PANEL_ATTR}], [aria-hidden="true"], [inert]`,
  /** Wrappers that say they are not controls themselves. */
  presentational: '[role="presentation"], [role="none"]',
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

/** Returned for a request that a newer one or Stop replaced: handled, nothing to say. */
export const STOPPED = '';

/** The answers to "is this control what was asked?", as options for Jev. */
export const CHECK_OPTIONS = [
  { id: 'same', description: 'It does what the user asked, or is the thing they named.' },
  { id: 'leads', description: 'It opens or goes to the place where what they asked is done.' },
  {
    id: 'other',
    description:
      'It is a different thing, even if it shares a word or looks similar: using it would do something the user did not ask for.',
  },
];

export const MESSAGES = {
  opened: (what: string): string => `Opened ${what}.`,
  done: (what: string): string => `Done: ${what}.`,
  alreadyOpen: (what: string): string => `Already open: ${what}.`,
  pointAt: (what: string): string => `Here's ${what}. I've highlighted it so you can finish.`,
  whichOne: (names: string[]): string =>
    names.length === 1
      ? `Did you mean ${names[0]}? I've highlighted it.`
      : `Did you mean ${names.join(' or ')}?`,
  notThere: (page: string): string => `Opened ${page}, but I couldn't find that there.`,
  notHere: (closest: string): string =>
    `I couldn't find that here. The closest was ${closest}, which is something else.`,
  notFound: (target: string, parent: string): string => `I couldn't find ${target} in ${parent}.`,
} as const;
