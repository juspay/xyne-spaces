import { describe, expect, it } from 'vitest';
import { planFromParts, stopOpenPlanTodos, toPlanTodos } from '../planParts';

describe('planParts', () => {
  const todos = [
    { id: 'a', title: 'Read', status: 'completed' as const },
    { id: 'b', title: 'Write', status: 'in_progress' as const },
    { title: 'Ship', status: 'pending' as const },
  ];

  it('reads the stored plan out of a turn’s parts', () => {
    const parts = [
      { type: 'text', id: '1:1', text: 'Done.' },
      { type: 'plan', id: 'plan', title: 'Release', todos },
    ];
    expect(planFromParts(parts)).toEqual({ todos, title: 'Release' });
    expect(planFromParts([{ type: 'text', id: '1', text: 'x' }])).toBeNull();
    expect(planFromParts(null)).toBeNull();
  });

  it('drops malformed todos and maps unknown statuses to pending', () => {
    expect(toPlanTodos([{ title: 'x', status: 'weird' }, { status: 'pending' }, 7])).toEqual([
      { title: 'x', status: 'pending' },
    ]);
    expect(toPlanTodos([])).toBeUndefined();
  });

  it('marks the in-progress step stopped and is a no-op otherwise', () => {
    expect(stopOpenPlanTodos(todos).map(t => t.status)).toEqual([
      'completed',
      'stopped',
      'pending',
    ]);
    const settled = [todos[0]!];
    expect(stopOpenPlanTodos(settled)).toBe(settled);
  });
});
