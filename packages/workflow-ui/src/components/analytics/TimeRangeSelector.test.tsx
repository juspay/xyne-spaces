import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeRangeSelector } from './TimeRangeSelector.js';

describe('TimeRangeSelector', () => {
  it('calls onChange with the clicked range', () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value={7} onChange={onChange} />);
    fireEvent.click(screen.getByText('14d'));
    expect(onChange).toHaveBeenCalledWith(14);
  });

  it('applies active style to the selected range button', () => {
    render(<TimeRangeSelector value={14} onChange={vi.fn()} />);
    const btn = screen.getByText('14d').closest('button');
    expect(btn?.className).toContain('bg-[var(--wui-primary)]');
  });
});
