export interface StepDef {
  title: string;
  command: string;
  args: string[];
  preRun?: () => void;
  env?: Record<string, string>;
  /** When false (or returns false), the step is skipped. Defaults to true. */
  condition?: boolean | (() => boolean);
  logFile?: string;
  /** If provided, this reason will be shown when the step is skipped. */
  skipReason?: string | (() => string);
}

export interface EnvSetup {
  composeProjectName: string;
  failedStage: string;
}

export interface StepResult {
  title: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number; // in milliseconds
  error?: string;
  description?: string;
}

export interface TestStatistics {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}
