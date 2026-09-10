import { createContext } from 'react';

// Own module: AutomationBuilder imports StepCard, so a step form reading this from it would cycle.
export const AutomationIdContext = createContext<string | undefined>(undefined);
