/**
 * The header is the provenance for a data citation: which step, what it is for,
 * and where in its output the value sits. Losing any of it turns the panel into
 * an unlabelled JSON dump.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { StepOutputView } from './StepOutputView.js';

// jsdom doesn't implement scrollIntoView; the component scrolls the cited value
// into view on mount. Supply it so these tests cover the header, not jsdom.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const output = { response: { riskGrade: 'MS-4', repoRate: '6.50' } };

function view(props: Partial<React.ComponentProps<typeof StepOutputView>> = {}) {
  return render(
    React.createElement(StepOutputView, {
      output,
      path: ['response', 'riskGrade'],
      label: 'Market data',
      stepId: 'market_data',
      description: 'Reference rates used for pricing.',
      ...props,
    }),
  );
}

describe('StepOutputView — header', () => {
  it('names the step by its title, its id, and its description', () => {
    view();
    expect(screen.getByText('Market data')).toBeDefined();
    // the id is what every {{ref}} and citation actually names, so a reader
    // cross-checking a ref needs it even when a friendly title exists
    expect(screen.getByText('market_data')).toBeDefined();
    expect(screen.getByText('Reference rates used for pricing.')).toBeDefined();
  });

  it('shows where in the output the cited value sits', () => {
    view();
    expect(screen.getByText('response.riskGrade')).toBeDefined();
  });

  it('omits the description and id cleanly when the step has none', () => {
    view({ description: undefined, stepId: undefined });
    expect(screen.getByText('Market data')).toBeDefined();
    expect(screen.queryByText('market_data')).toBeNull();
    expect(screen.queryByText('Reference rates used for pricing.')).toBeNull();
  });
});

describe('StepOutputView — the cited value', () => {
  it('surfaces the cited value separately from the full output', () => {
    view();
    expect(screen.getByText('Cited value')).toBeDefined();
    expect(screen.getByText('MS-4')).toBeDefined();
  });

  // A path that doesn't exist must say so rather than showing the whole output
  // as though it were the citation.
  it('says so when the cited path is absent, instead of implying the output is the citation', () => {
    view({ path: ['response', 'notThere'] });
    expect(screen.getByText(/isn’t present in this step’s output/)).toBeDefined();
    expect(screen.queryByText('Cited value')).toBeNull();
  });

  it('renders the whole output when nothing specific was cited', () => {
    view({ path: undefined });
    expect(screen.queryByText('Cited value')).toBeNull();
    expect(screen.getByText('Step output')).toBeDefined();
  });
});
