import * as fs from 'node:fs';

export type ScenarioProgressStatus = 'passed' | 'failed';

export interface ScenarioProgressEvent {
  scenarioId: string;
  scenarioName: string;
  status: ScenarioProgressStatus;
  timestamp: string;
}

export interface TestProgressStats {
  completed: number;
  remaining: number;
  passed: number;
  failed: number;
  percentage: number;
  total: number;
}

export interface TestProgressUpdate {
  event: ScenarioProgressEvent;
  stats: TestProgressStats;
}

function isScenarioProgressEvent(value: unknown): value is ScenarioProgressEvent {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<ScenarioProgressEvent>;
  return (
    typeof candidate.scenarioId === 'string' &&
    typeof candidate.scenarioName === 'string' &&
    (candidate.status === 'passed' || candidate.status === 'failed') &&
    typeof candidate.timestamp === 'string'
  );
}

export function appendScenarioProgressEvent(
  progressFile: string,
  event: ScenarioProgressEvent
): void {
  fs.appendFileSync(progressFile, `${JSON.stringify(event)}\n`, 'utf8');
}

export function formatTestProgress(
  stats: TestProgressStats,
  event?: ScenarioProgressEvent
): string {
  const latest = event ? ` | ${event.status.toUpperCase()}: ${event.scenarioName}` : '';

  return (
    `[TEST PROGRESS] ${stats.percentage}%` +
    ` | ran ${stats.completed}/${stats.total}` +
    ` | remaining ${stats.remaining}` +
    ` | passed ${stats.passed}` +
    ` | failed ${stats.failed}${latest}`
  );
}

export class TestProgressTracker {
  private readonly outcomes = new Map<string, ScenarioProgressStatus>();
  private processedLineCount = 0;

  public constructor(
    private readonly progressFile: string,
    private readonly total: number
  ) {}

  public getStats(): TestProgressStats {
    let passed = 0;
    let failed = 0;

    for (const status of this.outcomes.values()) {
      if (status === 'passed') passed++;
      else failed++;
    }

    const completed = this.outcomes.size;
    const remaining = Math.max(this.total - completed, 0);
    const percentage =
      this.total === 0 ? 100 : Math.min(100, Math.floor((completed / this.total) * 100));

    return { completed, remaining, passed, failed, percentage, total: this.total };
  }

  public drain(): TestProgressUpdate[] {
    if (!fs.existsSync(this.progressFile)) return [];

    const content = fs.readFileSync(this.progressFile, 'utf8');
    const lines = content.split('\n');

    // appendScenarioProgressEvent always terminates complete records with a
    // newline. Ignore a trailing partial record if a read overlaps a write.
    lines.pop();

    const updates: TestProgressUpdate[] = [];

    while (this.processedLineCount < lines.length) {
      const line = lines[this.processedLineCount++];
      if (!line) continue;

      try {
        const parsed: unknown = JSON.parse(line);
        if (!isScenarioProgressEvent(parsed)) continue;

        this.outcomes.set(parsed.scenarioId, parsed.status);
        updates.push({ event: parsed, stats: this.getStats() });
      } catch {
        // Ignore a malformed event without breaking the test run. The final
        // Gauge report remains the source of truth for the summary.
      }
    }

    return updates;
  }
}
