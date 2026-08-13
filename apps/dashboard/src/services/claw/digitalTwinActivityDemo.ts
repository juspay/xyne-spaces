export interface DigitalTwinActivitySchedule {
  id: string;
  name: string;
  cadence: string;
  status: 'active' | 'paused';
  runsCount: number;
}

export interface DigitalTwinActivityWorkflow {
  id: string;
  name: string;
  steps: number;
  published: boolean;
}

export interface DigitalTwinActivityRun {
  id: string;
  task: string;
  status: 'completed' | 'running' | 'failed' | 'cancelled';
  userName: string;
  triggerSource: string;
  startedAt: string;
}

export const DIGITAL_TWIN_ACTIVITY_SCHEDULES: readonly DigitalTwinActivitySchedule[] = [
  {
    id: 'dt-schedule-daily',
    name: 'Daily memory scan',
    cadence: 'Repeats · 0 9 * * *',
    status: 'active',
    runsCount: 42,
  },
  {
    id: 'dt-schedule-weekly',
    name: 'Weekly profile refresh',
    cadence: 'Repeats · 0 8 * * 1',
    status: 'active',
    runsCount: 11,
  },
  {
    id: 'dt-schedule-proposals',
    name: 'Proposal digest',
    cadence: 'Runs once · Fri, 4:00 PM',
    status: 'paused',
    runsCount: 3,
  },
];

export const DIGITAL_TWIN_ACTIVITY_WORKFLOWS: readonly DigitalTwinActivityWorkflow[] = [
  {
    id: 'dt-workflow-learning',
    name: 'Twin learning pipeline',
    steps: 4,
    published: true,
  },
  {
    id: 'dt-workflow-review',
    name: 'Proposal review chain',
    steps: 3,
    published: true,
  },
  {
    id: 'dt-workflow-recall',
    name: 'Recall quality check',
    steps: 2,
    published: false,
  },
];

export const DIGITAL_TWIN_ACTIVITY_RUNS: readonly DigitalTwinActivityRun[] = [
  {
    id: 'dt-run-1',
    task: 'Daily learning pass',
    status: 'completed',
    userName: 'You',
    triggerSource: 'schedule',
    startedAt: new Date(Date.now() - 35 * 60_000).toISOString(),
  },
  {
    id: 'dt-run-2',
    task: 'Review Communication proposals',
    status: 'completed',
    userName: 'You',
    triggerSource: 'manual',
    startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  },
  {
    id: 'dt-run-3',
    task: 'History import — #product-design',
    status: 'running',
    userName: 'You',
    triggerSource: 'backfill',
    startedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
  },
  {
    id: 'dt-run-4',
    task: 'Profile refresh',
    status: 'completed',
    userName: 'You',
    triggerSource: 'schedule',
    startedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
  },
  {
    id: 'dt-run-5',
    task: 'Twin reply gate — #eng-platform',
    status: 'failed',
    userName: 'You',
    triggerSource: 'message',
    startedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  },
  {
    id: 'dt-run-6',
    task: 'File import — onboarding-notes.pdf',
    status: 'completed',
    userName: 'You',
    triggerSource: 'upload',
    startedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  },
];
