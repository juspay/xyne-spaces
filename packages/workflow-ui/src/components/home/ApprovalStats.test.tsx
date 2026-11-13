import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ApprovalTimelinessCard, PendingApprovalsRingCard } from './ApprovalStats.js';

describe('ApprovalTimelinessCard', () => {
  it('shows on time vs late and the on-time share', () => {
    render(<ApprovalTimelinessCard data={{ onTime: 9, late: 3 }} isLoading={false} error={null} />);
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('On time')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('Late')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('says so when nothing was decided', () => {
    render(<ApprovalTimelinessCard data={{ onTime: 0, late: 0 }} isLoading={false} error={null} />);
    expect(screen.getByText(/No approvals decided/)).toBeTruthy();
  });
});

describe('PendingApprovalsRingCard', () => {
  it('shows the total and slices that add up to it', () => {
    render(<PendingApprovalsRingCard total={20} overdue={4} dueToday={3} dueSoon={2} />);
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.getByText('Overdue').nextSibling?.textContent).toBe('4');
    expect(screen.getByText('Due today').nextSibling?.textContent).toBe('3');
    expect(screen.getByText('Due in 2 days').nextSibling?.textContent).toBe('2');
    // The rest — later deadline or none — so the ring adds up to 20.
    expect(screen.getByText('Later').nextSibling?.textContent).toBe('11');
  });
});
