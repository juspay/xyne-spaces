import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CitationEditor } from './CitationEditor.js';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';

const config: WorkflowConfig = { trigger: { type: 'MANUAL', config: {} }, steps: [] };

describe('CitationEditor', () => {
  it('lists existing citations (label, ref, description)', () => {
    render(
      <CitationEditor
        config={config}
        atStepId="s1"
        citations={[{ ref: '{{trigger.attachments}}', label: 'Dispute letter', description: 'signed doc' }]}
        onAdd={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Dispute letter')).toBeInTheDocument();
    expect(screen.getByText('{{trigger.attachments}}')).toBeInTheDocument();
    expect(screen.getByText('signed doc')).toBeInTheDocument();
  });

  it('falls back to the ref as the title when no label', () => {
    render(
      <CitationEditor
        config={config}
        atStepId="s1"
        citations={[{ ref: '{{steps.a.output.x}}' }]}
        onAdd={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('{{steps.a.output.x}}')).toBeInTheDocument();
  });

  it('removing a citation calls onRemove with its index', () => {
    let removed: number | null = null;
    render(
      <CitationEditor
        config={config}
        atStepId="s1"
        citations={[{ ref: '{{a}}', label: 'one' }, { ref: '{{b}}', label: 'two' }]}
        onAdd={() => {}}
        onRemove={(i) => { removed = i; }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getAllByLabelText('Remove source')[1]!);
    expect(removed).toBe(1);
  });

  it('shows the "Add source" affordance', () => {
    render(
      <CitationEditor
        config={config}
        atStepId="s1"
        citations={[]}
        onAdd={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Add source')).toBeInTheDocument();
  });
});
