import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowUIProvider } from '../../provider/WorkflowUIProvider.js';
import { VariablesPanel } from './VariablesPanel.js';
import type { WorkflowVariable } from '@xyne/workflow-sdk/builder';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';

// The panel only touches the client for document uploads; scalar rows don't.
const client = {} as WorkflowClient;

function renderPanel(variables: WorkflowVariable[]) {
  const onChange = vi.fn();
  render(
    <WorkflowUIProvider client={client}>
      <VariablesPanel variables={variables} onChange={onChange} readOnly={false} />
    </WorkflowUIProvider>,
  );
  return onChange;
}

describe('VariablesPanel', () => {
  it('renders existing variables with their key and value', () => {
    renderPanel([{ key: 'companyName', type: 'text', value: 'Acme' }]);
    expect(screen.getByDisplayValue('companyName')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme')).toBeInTheDocument();
  });

  it('adds a variable', () => {
    const onChange = renderPanel([]);
    fireEvent.click(screen.getByText('+ Add variable'));
    expect(onChange).toHaveBeenCalledWith([{ key: '', type: 'text', value: '' }]);
  });

  it('edits a variable key', () => {
    const onChange = renderPanel([{ key: 'a', type: 'text', value: 'x' }]);
    fireEvent.change(screen.getByDisplayValue('a'), { target: { value: 'ab' } });
    expect(onChange).toHaveBeenCalledWith([{ key: 'ab', type: 'text', value: 'x' }]);
  });

  it('reseeds the value when the type changes', () => {
    const onChange = renderPanel([{ key: 'a', type: 'text', value: 'x' }]);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'number' } });
    expect(onChange).toHaveBeenCalledWith([{ key: 'a', type: 'number', value: 0 }]);
  });

  it('removes a variable', () => {
    const onChange = renderPanel([{ key: 'a', type: 'text', value: 'x' }]);
    fireEvent.click(screen.getByTitle('Remove'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
