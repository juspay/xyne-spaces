import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MultiSelectCheckboxes } from './MultiSelectCheckboxes.js';

describe('MultiSelectCheckboxes', () => {
  it('drops a stored value that is no longer an option on the next change', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectCheckboxes
        options={['opened', 'closed']}
        value={['submitted', 'opened']}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'closed' }));

    expect(onChange).toHaveBeenCalledWith(['opened', 'closed']);
  });
});
