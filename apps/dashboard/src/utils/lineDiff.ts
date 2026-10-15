import { diffLines, type Change } from 'diff';

export interface LineDiffRow {
  type: 'eq' | 'add' | 'del';
  text: string;
}

export function computeLineDiff(before: string, after: string): LineDiffRow[] {
  const rows: LineDiffRow[] = [];
  for (const change of diffLines(before, after) as Change[]) {
    const type: LineDiffRow['type'] = change.added ? 'add' : change.removed ? 'del' : 'eq';
    const lines = change.value.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const text of lines) rows.push({ type, text });
  }
  return rows;
}

export function lineDiffStats(rows: LineDiffRow[]): { added: number; removed: number } {
  return {
    added: rows.filter(row => row.type === 'add').length,
    removed: rows.filter(row => row.type === 'del').length,
  };
}
