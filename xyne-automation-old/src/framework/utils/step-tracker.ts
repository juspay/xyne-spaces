/**
 * Custom Step Tracker for Orchestrator
 * Tracks test steps using Playwright's native test.step()
 * Works seamlessly with the orchestrator's continueOnFailure mode
 */

import { test } from '@playwright/test';

export interface StepInfo {
  title: string;
  duration: number;
  error?: string;
  category?: string;
  location?: string;
}

export class StepTracker {
  private steps: StepInfo[] = [];
  private currentStepStart: number | null = null;
  private currentStepTitle: string | null = null;

  /**
   * Start tracking a new step
   */
  startStep(title: string, category: string = 'test.step'): void {
    // If there's a previous step running, end it first
    if (this.currentStepTitle) {
      this.endStep();
    }

    this.currentStepTitle = title;
    this.currentStepStart = Date.now();
  }

  /**
   * End the current step
   */
  endStep(error?: Error | string): void {
    if (!this.currentStepTitle || !this.currentStepStart) {
      return;
    }

    const duration = Date.now() - this.currentStepStart;
    const errorMessage = error instanceof Error ? error.message : error;

    // Extract location from error stack if available
    let location: string | undefined;
    if (error instanceof Error && error.stack) {
      const locationMatch = error.stack.match(/at\s+.*?\s+\((.+?):(\d+):(\d+)\)/);
      if (locationMatch) {
        location = `${locationMatch[1]}:${locationMatch[2]}`;
      }
    }

    this.steps.push({
      title: this.currentStepTitle,
      duration,
      error: errorMessage,
      category: 'test.step',
      location
    });

    this.currentStepStart = null;
    this.currentStepTitle = null;
  }

  /**
   * Track a step with automatic timing
   */
  async trackStep<T>(
    title: string,
    fn: () => Promise<T> | T,
    category: string = 'test.step'
  ): Promise<T> {
    this.startStep(title, category);
    const startTime = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - startTime;

      this.steps.push({
        title,
        duration,
        category
      });

      this.currentStepStart = null;
      this.currentStepTitle = null;

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Extract location from error stack
      let location: string | undefined;
      if (error instanceof Error && error.stack) {
        const locationMatch = error.stack.match(/at\s+.*?\s+\((.+?):(\d+):(\d+)\)/);
        if (locationMatch) {
          const fileParts = locationMatch[1].split('/');
          const fileName = fileParts[fileParts.length - 1];
          location = `${fileName}:${locationMatch[2]}`;
        }
      }

      this.steps.push({
        title,
        duration,
        error: errorMessage,
        category,
        location
      });

      this.currentStepStart = null;
      this.currentStepTitle = null;

      throw error;
    }
  }

  /**
   * Get all recorded steps
   */
  getSteps(): StepInfo[] {
    // End any running step before returning
    if (this.currentStepTitle) {
      this.endStep();
    }
    return [...this.steps];
  }

  /**
   * Clear all steps
   */
  clear(): void {
    this.steps = [];
    this.currentStepStart = null;
    this.currentStepTitle = null;
  }

  /**
   * Get total duration of all steps
   */
  getTotalDuration(): number {
    return this.steps.reduce((sum, step) => sum + step.duration, 0);
  }

  /**
   * Get step count
   */
  getStepCount(): number {
    return this.steps.length;
  }

  /**
   * Get failed steps count
   */
  getFailedStepsCount(): number {
    return this.steps.filter(s => s.error).length;
  }
}

// Global step tracker instance for the current test
let currentTracker: StepTracker | null = null;

/**
 * Get or create the step tracker for the current test
 */
export function getStepTracker(): StepTracker {
  if (!currentTracker) {
    currentTracker = new StepTracker();
  }
  return currentTracker;
}

/**
 * Reset the step tracker (call at the start of each test)
 */
export function resetStepTracker(): StepTracker {
  currentTracker = new StepTracker();
  return currentTracker;
}

/**
 * Helper function to track a step with location capture
 * Uses Playwright's native test.step() so steps appear in testInfo
 * Automatically appends caller location to step title
 */
export async function step<T>(
  title: string,
  fn: () => Promise<T> | T
): Promise<T> {
  // Capture caller location from stack trace (if not already in title)
  if (!title.includes('—')) {
    const location = getCallerLocation();
    if (location) {
      title = `${title}${location}`;
    }
  }

  return await test.step(title, fn);
}

/**
 * Get caller location from stack trace
 * Returns format: "— filename.ts:123"
 */
function getCallerLocation(): string | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;

  const lines = stack.split('\n');
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];

    // Skip internal framework files
    if (line.includes('step-tracker') ||
        line.includes('instrumented-page') ||
        line.includes('node_modules') ||
        line.includes('test-fixtures')) {
      continue;
    }

    // Extract file and line number
    const match = line.match(/\((.+):(\d+):(\d+)\)|at\s+(.+):(\d+):(\d+)/);
    if (match) {
      const filePath = match[1] || match[4];
      const lineNum = match[2] || match[5];

      // Get relative path from project root
      const fileName = filePath.split('/').pop();
      return `— ${fileName}:${lineNum}`;
    }
  }

  return undefined;
}
