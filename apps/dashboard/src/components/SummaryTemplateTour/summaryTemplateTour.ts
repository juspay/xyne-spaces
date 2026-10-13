import { useSyncExternalStore } from 'react';

/**
 * Guided walkthrough of creating a recording summary template.
 *
 * It auto-starts once per browser; the shown flag uses the same localStorage
 * key style as `useWalkthrough`. This store itself only tracks the current step.
 */
export const SUMMARY_TEMPLATE_TOUR_SHOWN_KEY = 'walkthrough_summary_templates';

export const hasShownSummaryTemplateTour = (): boolean => {
  try {
    return localStorage.getItem(SUMMARY_TEMPLATE_TOUR_SHOWN_KEY) === 'true';
  } catch {
    return true;
  }
};

const markSummaryTemplateTourShown = (): void => {
  try {
    localStorage.setItem(SUMMARY_TEMPLATE_TOUR_SHOWN_KEY, 'true');
  } catch {
    // Storage unavailable: the tour may auto-start again next visit, which is harmless.
  }
};

export type SummaryTemplateTourStepId =
  | 'open-templates'
  | 'new-template'
  | 'name'
  | 'context'
  | 'sections'
  | 'save';

export interface SummaryTemplateTourStep {
  id: SummaryTemplateTourStepId;
  title: string;
  body: string;
}

export const SUMMARY_TEMPLATE_TOUR_STEPS: readonly SummaryTemplateTourStep[] = [
  {
    id: 'open-templates',
    title: 'Summary templates',
    body: 'Templates decide what every recording summary covers and how it is laid out. This is where you manage them.',
  },
  {
    id: 'new-template',
    title: 'Start a new template',
    body: 'Create one for each kind of meeting you run, like a customer call or a sprint review. Next starts one for you.',
  },
  {
    id: 'name',
    title: 'Name it',
    body: 'Use a name that says what the meeting is, like “Customer discovery call”. It is how you will spot the template later.',
  },
  {
    id: 'context',
    title: 'Describe the meeting',
    body: 'Tell AI what this kind of meeting is about. Xyne uses it to auto-pick the template for matching recordings. Let AI draft it if you prefer.',
  },
  {
    id: 'sections',
    title: 'Choose the sections',
    body: 'Each section becomes a part of the summary, like Decisions or Action items. Add your own or let AI suggest them.',
  },
  {
    id: 'save',
    title: 'Save and use it',
    body: 'Save the template, then pick it from the Summary tab of any recording to regenerate that summary in this shape.',
  },
];

// `null` while the tour is not running.
let stepIndex: number | null = null;
const listeners = new Set<() => void>();

const emit = (): void => listeners.forEach(listener => listener());

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): number | null => stepIndex;
const getServerSnapshot = (): number | null => null;

const setStepIndex = (next: number | null): void => {
  if (stepIndex === next) return;
  stepIndex = next;
  emit();
};

export const summaryTemplateTour = {
  isActive: (): boolean => stepIndex !== null,
  /** Starts the tour on request (a replay never consults the shown flag). */
  start: (): void => setStepIndex(0),
  /** Auto-start: runs once per browser and records that it was shown. */
  startOnce: (): boolean => {
    if (stepIndex !== null || hasShownSummaryTemplateTour()) return false;
    markSummaryTemplateTourShown();
    setStepIndex(0);
    return true;
  },
  /** Moves on; past the last step this just closes the tour. */
  next: (): void => {
    if (stepIndex === null) return;
    if (stepIndex >= SUMMARY_TEMPLATE_TOUR_STEPS.length - 1) {
      setStepIndex(null);
      return;
    }
    setStepIndex(stepIndex + 1);
  },
  back: (): void => {
    if (stepIndex === null || stepIndex === 0) return;
    setStepIndex(stepIndex - 1);
  },
  dismiss: (): void => setStepIndex(null),
};

export interface SummaryTemplateTourState {
  activeStep: SummaryTemplateTourStepId | null;
  stepIndex: number | null;
  stepCount: number;
}

export const useSummaryTemplateTour = (): SummaryTemplateTourState => {
  const index = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    activeStep: index === null ? null : (SUMMARY_TEMPLATE_TOUR_STEPS[index]?.id ?? null),
    stepIndex: index,
    stepCount: SUMMARY_TEMPLATE_TOUR_STEPS.length,
  };
};
