import { describe, it, expect } from 'vitest';
import { parseRoute } from './WorkflowApp.js';

describe('parseRoute — run URLs', () => {
  it('reads a run and its node id', () => {
    expect(parseRoute('runs/abc123')).toEqual({ kind: 'run', executionId: 'abc123' });
    expect(parseRoute('runs/abc123/report')).toEqual({
      kind: 'run', executionId: 'abc123', nodeId: 'report',
    });
  });

  it('keeps nested node paths whole — they contain slashes', () => {
    expect(parseRoute('runs/abc123/deep_research:biz_overview#0/biz_overview')).toEqual({
      kind: 'run', executionId: 'abc123', nodeId: 'deep_research:biz_overview#0/biz_overview',
    });
    expect(parseRoute('runs/abc123/analyze_rows:item#3/report')).toEqual({
      kind: 'run', executionId: 'abc123', nodeId: 'analyze_rows:item#3/report',
    });
  });

  it('splits off a trailing attachment id', () => {
    expect(parseRoute('runs/abc123/report/cxtfeiqpstwywnel6vyl42lv-report.html')).toEqual({
      kind: 'run',
      executionId: 'abc123',
      nodeId: 'report',
      fileId: 'cxtfeiqpstwywnel6vyl42lv-report.html',
    });
  });

  it('addresses one row of a batch — node index and file id both vary', () => {
    const row = (i: number, id: string) =>
      parseRoute(`runs/abc123/analyze_rows:item#${String(i)}/report/${id}-report.html`);
    expect(row(0, 'k4f9eiqpstwywnel6vyl4')).toMatchObject({
      nodeId: 'analyze_rows:item#0/report', fileId: 'k4f9eiqpstwywnel6vyl4-report.html',
    });
    expect(row(1, 'p2m7eiqpstwywnel6vyl4')).toMatchObject({
      nodeId: 'analyze_rows:item#1/report', fileId: 'p2m7eiqpstwywnel6vyl4-report.html',
    });
  });

  it('does not mistake a step id for an attachment', () => {
    // No extension, too short, or no cuid2 prefix — all are node ids.
    for (const tail of ['report', 'fill_template', 'build-sheet', 'a-b.html']) {
      expect(parseRoute(`runs/abc123/step/${tail}`)).toEqual({
        kind: 'run', executionId: 'abc123', nodeId: `step/${tail}`,
      });
    }
  });

  it('leaves the other routes alone', () => {
    // The empty path lands on the home dashboard now, and "workflows" is a
    // path of its own (changed with the home/approvals redesign upstream).
    expect(parseRoute('')).toEqual({ kind: 'home', tab: 'home' });
    expect(parseRoute('workflows')).toEqual({ kind: 'home', tab: 'workflows' });
    expect(parseRoute('executions')).toEqual({ kind: 'home', tab: 'executions' });
    expect(parseRoute('w/wf1')).toEqual({ kind: 'workflow', workflowId: 'wf1', view: 'runs' });
    expect(parseRoute('w/wf1/edit')).toEqual({ kind: 'workflow', workflowId: 'wf1', view: 'builder' });
  });
});
