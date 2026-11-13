import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge.js';

describe('StatusBadge', () => {
  it('renders the status label', () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('renders a custom label', () => {
    render(<StatusBadge status="running" label="In Progress" />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <StatusBadge status="failed" className="my-custom-class" />,
    );
    expect(container.firstElementChild?.className).toContain('my-custom-class');
  });

  it('renders all status variants without error', () => {
    const variants = ['pending', 'running', 'completed', 'failed', 'paused', 'skipped', 'cancelled'] as const;
    for (const status of variants) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    }
  });
});
