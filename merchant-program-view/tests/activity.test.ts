import { describe, expect, it } from 'vitest';
import { activityItem, type ActivityInput, type Lookups } from '../lib/activity';

const L: Lookups = {
  user: id => ({ u1: 'Lisa Roy', u2: 'Vivek Nikam' })[id],
  group: id => ({ g1: 'Payments', g2: 'Risk' })[id],
  board: id => ({ b1: 'Euler', b2: 'Xyne-Spaces' })[id],
};
let seq = 0;
const a = (activityType: string, value: unknown, updatedBy = 'u1'): ActivityInput => ({ id: `a${++seq}`, ticketId: 't', activityType, value, timestamp: Date.UTC(2026, 0, 21, 10), updatedBy });
// Bold spans as **x** so each line reads like the dashboard's sentence.
const line = (x: ActivityInput): string => {
  const it = activityItem(x, L);
  return [it.actor, ...it.parts.map(p => (typeof p === 'string' ? p : 'b' in p ? `**${p.b}**` : `[${p.link}](${p.href ?? ''})`))]
    .filter(Boolean)
    .join(' ')
    .replace(/ ([,.:;])/g, '$1')
    .replace(/ {2,}/g, ' ');
};

describe('activityItem', () => {
  it('words field changes like the dashboard, with old and new values in bold', () => {
    expect(line(a('TITLE', { oldValue: 'A', newValue: 'B' }))).toBe('Lisa Roy updated title from **A** to **B**');
    expect(line(a('DESCRIPTION', {}))).toBe('Lisa Roy updated description');
    expect(line(a('STATUS', { field: 'stageName', oldValue: 'To Do', newValue: 'In Progress' }))).toBe('Lisa Roy moved ticket from **To Do** to **In Progress**');
    expect(line(a('STATUS', { field: 'statusV2', oldValue: 'TODO', newValue: 'COMPLETED' }))).toBe('Lisa Roy changed status from **TODO** to **COMPLETED**');
    expect(line(a('TICKET_TYPE', { oldValue: null, newValue: 'Bug' }))).toBe('Lisa Roy changed ticket type from **none** to **Bug**');
    expect(line(a('PRIORITY', { oldValue: 'LOW', newValue: 'HIGH' }))).toBe('Lisa Roy changed priority from **LOW** to **HIGH**');
    expect(line(a('TAGS', { action: 'added', newValue: 'urgent' }))).toBe('Lisa Roy added a label: **urgent**');
    expect(line(a('TAGS', { action: 'removed', oldValue: 'urgent' }))).toBe('Lisa Roy removed a label: **urgent**');
  });

  it('resolves people, groups and boards, and words self and automatic assignment', () => {
    expect(line(a('ASSIGNED_TO', { oldValue: 'u1', newValue: 'u2' }))).toBe('Lisa Roy changed assignment from **Lisa Roy** to **Vivek Nikam**');
    expect(line(a('ASSIGNED_TO', { oldValue: null, newValue: 'u1' }))).toBe('Lisa Roy self-assigned the ticket');
    expect(line(a('ASSIGNED_TO', { newValue: 'u2', reason: 'AI classification' }))).toBe('Auto-assigned to **Vivek Nikam**');
    expect(line(a('USER_GROUP_ID', { oldValue: 'g1', newValue: 'g2' }))).toBe('Lisa Roy transferred ticket from **Payments** to **Risk**');
    expect(line(a('BOARD', { oldValue: 'b1', newValue: 'b2' }))).toBe('Lisa Roy moved ticket from board **Euler** to **Xyne-Spaces**');
    expect(activityItem(a('ASSIGNED_TO', { newValue: 'u2' }), L).icon).toBe('avatar');
  });

  it('shows dates as days, and handles sub-tickets, merges, fields and email', () => {
    expect(line(a('ETA', { oldValue: null, newValue: Date.UTC(2026, 1, 3, 12) }))).toBe('Lisa Roy changed due date from **none** to **3 Feb 2026**');
    expect(line(a('STAGE_ETA', { oldValue: Date.UTC(2026, 1, 3, 12), newValue: Date.UTC(2026, 1, 5, 12) }))).toBe('Lisa Roy updated stage deadline from **3 Feb 2026** to **5 Feb 2026**');
    expect(line(a('SUBTICKET_CREATED', { subTicketXyneId: 'EULER-1' }))).toBe('Lisa Roy created subticket **EULER-1**');
    expect(line(a('MERGED', { sourceTicketId: 'x', sourceTicketXyneId: 'M-2' }))).toBe('Lisa Roy merged **M-2** into this ticket');
    expect(line(a('METADATA', { field: 'customField', fieldName: 'MID', oldValue: 'a', newValue: 'b' }))).toBe('Lisa Roy updated MID from **a** to **b**');
    expect(line(a('METADATA', { field: 'customField', fieldName: 'MID', newValue: 'b', contextName: 'Intake' }))).toBe('Lisa Roy set MID in Intake form **b**');
    expect(line(a('EMAIL_SENT', {}))).toBe('Lisa Roy sent an email reply');
    expect(line(a('TICKET_CREATED', {}))).toBe('Lisa Roy created the ticket');
  });

  it('words PR rows like the dashboard: linked number, action, stage move, author, no actor', () => {
    expect(line(a('PR', { prId: 5091, prUrl: 'https://git/pr/5091', action: 'merged', authorName: 'Prakul M' }))).toBe('PR [#5091](https://git/pr/5091) merged, author: **Prakul M**');
    expect(line(a('PR', { prId: 7, field: 'stageName', oldValue: 'PR Review', newValue: 'Merged', authorName: 'A B', remainingOpenPRs: 2 }))).toBe(
      'PR [#7]() updated, **PR Review** → **Merged**, author: **A B**, 2 PRs remaining',
    );
    expect(activityItem(a('PR', { prId: 1 }), L).actor).toBeNull();
  });

  it('names automation and falls back for unknown people and types', () => {
    expect(line(a('PRIORITY', { oldValue: 'LOW', newValue: 'HIGH', isAutomation: true }))).toBe('Automation changed priority from **LOW** to **HIGH**');
    expect(line(a('TITLE', { oldValue: 'A', newValue: 'B' }, 'nobody'))).toBe('Someone updated title from **A** to **B**');
    expect(line(a('CLOSED_AT', {}))).toBe('Lisa Roy made a change');
  });
});
