import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
  type ReactElement,
} from 'react';
import { xyneAIActor } from '../machines/xyneAIMachine';

// --- Constants ---

const STORAGE_KEY = 'xyne-ai-onboarding-completed';
const ACTIVE_KEY = 'xyne-ai-onboarding-active';
const PENDING_KEY = 'xyne-ai-onboarding-pending';

/** All onboarding suggestion questions in display order */
export const ALL_ONBOARDING_SUGGESTIONS = [
  'What is Xyne Spaces and what can I do here?',
  'What are Channels and how do they work?',
  'How can I use Ask AI to help me?',
  'What integrations are available?',
  'How do I create and manage Tickets?',
  'What are Workflows and how can I use them?',
  'How do Canvas and Docs work?',
  'Can I make Calls and record meetings?',
  'How do I search across all my tools?',
  'What keyboard shortcuts should I know?',
  'How do I customize my workspace?',
  'What can I do with Projects?',
];

// --- State & Actions ---

interface AIOnboardingState {
  isActive: boolean;
  startTime: number | null;
  source: 'auto' | 'manual' | null;
}

type AIOnboardingAction =
  | { type: 'START_ONBOARDING'; source: 'auto' | 'manual' }
  | { type: 'COMPLETE_ONBOARDING' };

function reducer(state: AIOnboardingState, action: AIOnboardingAction): AIOnboardingState {
  switch (action.type) {
    case 'START_ONBOARDING':
      localStorage.setItem(ACTIVE_KEY, 'true');
      return {
        ...state,
        isActive: true,
        startTime: Date.now(),
        source: action.source,
      };

    case 'COMPLETE_ONBOARDING':
      localStorage.setItem(STORAGE_KEY, 'true');
      localStorage.removeItem(ACTIVE_KEY);
      return {
        ...state,
        isActive: false,
        source: null,
      };

    default:
      return state;
  }
}

const initialState: AIOnboardingState = {
  isActive: false,
  startTime: null,
  source: null,
};

// --- Context ---

interface AIOnboardingContextValue {
  state: AIOnboardingState;
  startOnboarding: (source: 'auto' | 'manual', startFreshChat?: boolean) => void;
  completeOnboarding: () => void;
}

const AIOnboardingContext = createContext<AIOnboardingContextValue | null>(null);

export function useAIOnboarding(): AIOnboardingContextValue {
  const ctx = useContext(AIOnboardingContext);
  if (!ctx) {
    throw new Error('useAIOnboarding must be used within AIOnboardingProvider');
  }
  return ctx;
}

// --- Helpers ---

export function isAIOnboardingCompleted(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function isAIOnboardingActive(): boolean {
  return localStorage.getItem(ACTIVE_KEY) === 'true';
}

export function isAIOnboardingPending(): boolean {
  return sessionStorage.getItem(PENDING_KEY) === 'true';
}

export function setAIOnboardingPending(): void {
  sessionStorage.setItem(PENDING_KEY, 'true');
}

export function clearAIOnboardingPending(): void {
  sessionStorage.removeItem(PENDING_KEY);
}

// --- Provider ---

interface AIOnboardingProviderProps {
  children: ReactNode;
}

export function AIOnboardingProvider({ children }: AIOnboardingProviderProps): ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState);

  const startOnboarding = useCallback((source: 'auto' | 'manual', startFreshChat = true) => {
    dispatch({ type: 'START_ONBOARDING', source });
    xyneAIActor.send({ type: 'OPEN', startFreshChat });
  }, []);

  const completeOnboarding = useCallback(() => {
    dispatch({ type: 'COMPLETE_ONBOARDING' });
    xyneAIActor.send({ type: 'CLOSE' });
    // Notify the Ask AI button to show a tooltip after a short delay (let panel close first)
    setTimeout(() => window.dispatchEvent(new Event('ai-onboarding-complete')), 500);
  }, []);

  return (
    <AIOnboardingContext.Provider value={{ state, startOnboarding, completeOnboarding }}>
      {children}
    </AIOnboardingContext.Provider>
  );
}
