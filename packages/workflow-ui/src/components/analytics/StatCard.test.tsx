import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from './StatCard.js';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Total Runs" value={142} />);
    expect(screen.getByText('Total Runs')).toBeDefined();
    expect(screen.getByText('142')).toBeDefined();
  });

  it('renders a % suffix when percent is true', () => {
    render(<StatCard label="Success Rate" value={87} percent />);
    expect(screen.getByText('87%')).toBeDefined();
  });

  it('renders a fraction when total is provided', () => {
    render(<StatCard label="Active" value={4} total={6} />);
    expect(screen.getByText('4/6')).toBeDefined();
  });
});
