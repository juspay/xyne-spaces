import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { KeyValueEditor } from './KeyValueEditor.js';
import { CitationCtx, type CitationCtxValue } from './field-source-control.js';

const config: WorkflowConfig = { trigger: { type: 'MANUAL', config: {} }, steps: [] };

function withCitations(stepConfig: Record<string, unknown>): CitationCtxValue {
  return {
    config,
    atStepId: 's1',
    stepConfig,
    citations: {},
    onAdd: () => {},
    onRemove: () => {},
  };
}

describe('KeyValueEditor — per-entry source control', () => {
  it('shows a "source" control per entry when recordPath is set', () => {
    render(
      <CitationCtx.Provider value={withCitations({ headers: { 'x-token': 'abc' } })}>
        <KeyValueEditor
          value={{ 'x-token': 'abc' }}
          onChange={() => {}}
          recordPath="headers"
        />
      </CitationCtx.Provider>,
    );
    expect(screen.getByText(/source/i)).toBeInTheDocument();
  });

  it('renders no source control without a recordPath (generic opt-in)', () => {
    render(
      <CitationCtx.Provider value={withCitations({ headers: { 'x-token': 'abc' } })}>
        <KeyValueEditor value={{ 'x-token': 'abc' }} onChange={() => {}} />
      </CitationCtx.Provider>,
    );
    expect(screen.queryByText(/source/i)).toBeNull();
  });

  it('renders no source control for an empty key (a record key is its own identity)', () => {
    render(
      <CitationCtx.Provider value={withCitations({ headers: {} })}>
        <KeyValueEditor value={{ '': 'abc' }} onChange={() => {}} recordPath="headers" />
      </CitationCtx.Provider>,
    );
    expect(screen.queryByText(/source/i)).toBeNull();
  });
});
