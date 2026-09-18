import type { OnboardingDomain, OnboardingRole, OnboardingTryFirst } from './onboardingFlow';

/**
 * Public /onboarding greeting beats from Figma canvas 254:867
 * (Dev's Version). Question chrome matches frame 303:3097 on every question.
 *
 * Title reveal matches Linear.app homepage hero (live inspect): one
 * nowrap inline-block span, blur(10px) + opacity 0 + translateY(20%) → sharp,
 * duration 1000ms, delay 400ms, easing cubic-bezier(0.25, 0.1, 0.25, 1).
 */
export const GREETING_HERO_BLUR_PX = 10;
export const GREETING_HERO_Y = '20%';
export const GREETING_HERO_DURATION = 1;
export const GREETING_HERO_EASE = [0.25, 0.1, 0.25, 1] as const;
export const GREETING_HERO_DELAY = 0.4;
export const GREETING_HERO_STAGGER_DESKTOP = 0.1;
export const GREETING_HERO_STAGGER_MOBILE = 0.033;
export const GREETING_OUT_DURATION = 0.4;
export const GREETING_HOLD_MS = 1750;
export const GREETING_SELECT_DWELL_MS = 520;
export const GREETING_REDUCED_HOLD_MS = 400;
export const GREETING_CHROME_DURATION = 0.55;
export const GREETING_CHROME_STAGGER = 0.06;
export const GREETING_CHROME_DELAY = 0.55;

export type GreetingBeatId =
  | 'hello'
  | 'tell-us'
  | 'day'
  | 'team'
  | 'drop'
  | 'connector-empty'
  | 'connector-talks'
  | 'connectors';

export type GreetingChoiceKey = OnboardingRole | OnboardingDomain | OnboardingTryFirst;

export interface GreetingQuestionOption {
  key: GreetingChoiceKey;
  label: string;
  input?: boolean;
}

export interface GreetingLineBeat {
  id: GreetingBeatId;
  kind: 'line';
  text: string;
}

export interface GreetingPromptBeat {
  id: GreetingBeatId;
  kind: 'prompt';
  text: string;
}

export interface GreetingQuestionBeat {
  id: GreetingBeatId;
  kind: 'question';
  title: string;
  options: readonly GreetingQuestionOption[];
}

export interface GreetingConnectorsBeat {
  id: 'connectors';
  kind: 'connectors';
  title: string;
  subtitle: string;
}

export type GreetingBeat =
  | GreetingLineBeat
  | GreetingPromptBeat
  | GreetingQuestionBeat
  | GreetingConnectorsBeat;

export const GREETING_FALLBACK_NAME = 'there';

/** First token of an email local-part, title-cased. Last resort: GREETING_FALLBACK_NAME. */
export function greetingDisplayName(email: string | undefined | null): string {
  const local = email?.split('@')[0]?.trim() ?? '';
  const token = local.split(/[._+\-\s]/).find(part => /[a-zA-Z]{2,}/.test(part)) ?? '';
  const letters = token.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 2) {
    return GREETING_FALLBACK_NAME;
  }
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

export function greetingHelloText(name: string): string {
  return `Hello ${name}`;
}

export const GREETING_DAY_OPTIONS = [
  { key: 'role_builder', label: 'Building and shipping' },
  { key: 'role_ops', label: 'Keeping things running' },
  { key: 'role_lead', label: 'Leading a team' },
  { key: 'role_other', label: 'A bit of everything' },
] as const satisfies readonly GreetingQuestionOption[];

export const GREETING_TEAM_OPTIONS = [
  { key: 'domain_software', label: 'Software' },
  { key: 'domain_finance', label: 'Payments and finance' },
  { key: 'domain_healthcare', label: 'Healthcare' },
  { key: 'domain_other', label: 'Something else', input: true },
] as const satisfies readonly GreetingQuestionOption[];

export const GREETING_DROP_OPTIONS = [
  { key: 'try_recap', label: 'Catching up on what I missed' },
  { key: 'try_support', label: 'Getting something off my plate' },
  { key: 'try_search', label: 'Finding a thing I know exists' },
  { key: 'try_chat', label: "Seeing what the team's on" },
] as const satisfies readonly GreetingQuestionOption[];

export const GREETING_BEATS: readonly GreetingBeat[] = [
  { id: 'hello', kind: 'line', text: 'Hello' },
  {
    id: 'tell-us',
    kind: 'prompt',
    text: "Tell us a little about how you work. We'll take care of the rest.",
  },
  {
    id: 'day',
    kind: 'question',
    title: "What's your day mostly made of?",
    options: GREETING_DAY_OPTIONS,
  },
  {
    id: 'team',
    kind: 'question',
    title: 'What does your team work on?',
    options: GREETING_TEAM_OPTIONS,
  },
  {
    id: 'drop',
    kind: 'question',
    title: 'Where should we drop you first?',
    options: GREETING_DROP_OPTIONS,
  },
  {
    id: 'connector-empty',
    kind: 'line',
    text: 'Xyne is empty until you plug something in.',
  },
  {
    id: 'connector-talks',
    kind: 'line',
    text: 'Start with wherever your team actually talks.',
  },
  {
    id: 'connectors',
    kind: 'connectors',
    title: 'Start with wherever your team actually talks.',
    subtitle: 'Xyne is empty until you plug something in.',
  },
];

/** Greeting titles stay one nowrap line — no desktop split, no mobile chunks. */
export function greetingHeroDesktopLines(text: string): string[] {
  return [text.trim()];
}

/** Same single line as desktop; kept so existing callers stay valid. */
export function greetingHeroMobileChunks(text: string): string[] {
  return greetingHeroDesktopLines(text);
}

export function greetingQuestionCanAdvance(
  option: { input?: boolean } | null | undefined,
  otherText: string,
): boolean {
  if (!option) {
    return false;
  }
  if (option.input === true) {
    return otherText.trim().length > 0;
  }
  return true;
}

const BEAT_BY_ID = Object.fromEntries(GREETING_BEATS.map(beat => [beat.id, beat])) as Record<
  GreetingBeatId,
  GreetingBeat
>;

export function greetingBeat(id: GreetingBeatId): GreetingBeat {
  return BEAT_BY_ID[id];
}

export function greetingBeatAfter(
  id: GreetingBeatId,
  action: 'advance' | 'skip',
): GreetingBeatId | 'complete' {
  if (action === 'skip') {
    if (id === 'tell-us') {
      return 'connector-empty';
    }
    if (id === 'connectors') {
      return 'complete';
    }
  }

  if (id === 'connectors') {
    return 'complete';
  }

  const index = GREETING_BEATS.findIndex(beat => beat.id === id);
  const next = GREETING_BEATS[index + 1];
  return next?.id ?? 'complete';
}

export function greetingInDurationMs(reduceMotion: boolean, childCount: number): number {
  if (reduceMotion) {
    return 50;
  }
  return Math.round(
    (GREETING_HERO_DELAY +
      GREETING_HERO_DURATION +
      GREETING_HERO_STAGGER_DESKTOP * Math.max(childCount - 1, 0) +
      0.05) *
      1000,
  );
}

/** Includes the wait-mode exit of the previous beat so ready is not set mid-enter. */
export function greetingReadyDelayMs(
  reduceMotion: boolean,
  childCount: number,
  includeExit: boolean,
): number {
  const enter = greetingInDurationMs(reduceMotion, childCount);
  if (reduceMotion || !includeExit) {
    return enter;
  }
  return enter + Math.round(GREETING_OUT_DURATION * 1000);
}
