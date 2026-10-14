import { useSyncExternalStore } from 'react';

/**
 * Guided walkthrough of changing and creating a recording summary template.
 *
 * The user starts it from the "New" pill beside the template selector on a
 * recording. The first steps run in the template dropdown, the rest inside the
 * Summary Templates dialog. Finishing or skipping the tour marks it taken in
 * localStorage (same key style as `useWalkthrough`), which hides the pill.
 */
const SUMMARY_TEMPLATE_TOUR_TAKEN_KEY = 'walkthrough_summary_templates';

const takenListeners = new Set<() => void>();

const readTaken = (): boolean => {
  try {
    return localStorage.getItem(SUMMARY_TEMPLATE_TOUR_TAKEN_KEY) === 'true';
  } catch {
    return false;
  }
};

const markTaken = (): void => {
  try {
    localStorage.setItem(SUMMARY_TEMPLATE_TOUR_TAKEN_KEY, 'true');
  } catch {
    // Storage unavailable: the pill stays, which is harmless.
  }
  takenListeners.forEach(listener => listener());
};

/** Whether the user has finished or skipped the tour on this device. */
export const useSummaryTemplateTourTaken = (): boolean =>
  useSyncExternalStore(
    listener => {
      takenListeners.add(listener);
      return () => takenListeners.delete(listener);
    },
    readTaken,
    () => false,
  );

export type SummaryTemplateTourStepId = 'pick-template' | 'new-template' | 'save';

export interface SummaryTemplateTourStep {
  id: SummaryTemplateTourStepId;
  title: string;
  body: string;
}

export const SUMMARY_TEMPLATE_TOUR_STEPS: readonly SummaryTemplateTourStep[] = [
  {
    id: 'pick-template',
    title: 'Pick a template',
    body: 'Each template shapes the summary differently. Choose one here and the summary is rewritten in that shape.',
  },
  {
    id: 'new-template',
    title: 'Or create your own',
    body: 'Make a template for each kind of meeting you run, like a customer call or a sprint review. Next opens the editor.',
  },
  {
    id: 'save',
    title: 'Fill it in and save',
    body: 'Give it a name, describe the meeting and add the sections you want, then hit Save. The template is ready to use right away.',
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

/** Steps that live in the template dropdown rather than the templates dialog. */
export const isSummaryTemplateMenuStep = (step: SummaryTemplateTourStepId | null): boolean =>
  step === 'pick-template' || step === 'new-template';

export const summaryTemplateTour = {
  start: (): void => setStepIndex(0),
  /** Moves on; past the last step the tour counts as taken and closes. */
  next: (): void => {
    if (stepIndex === null) return;
    if (stepIndex >= SUMMARY_TEMPLATE_TOUR_STEPS.length - 1) {
      markTaken();
      setStepIndex(null);
      return;
    }
    setStepIndex(stepIndex + 1);
  },
  /** "Skip tour": counts as taken, unlike an incidental close. */
  skip: (): void => {
    markTaken();
    setStepIndex(null);
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
