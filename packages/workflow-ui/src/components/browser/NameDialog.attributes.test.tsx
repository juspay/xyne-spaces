import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import { NameDialog } from './NameDialog.js';
import type { AttributeFieldsProps } from '../../types/slots.js';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';

// NameDialog never touches the client; the provider just needs one present.
const client = {} as WorkflowClient;

function DeptField({ value, onChange }: AttributeFieldsProps) {
  return (
    <input
      aria-label="department"
      value={(value as { department?: string }).department ?? ''}
      onChange={(e) => onChange({ department: e.target.value })}
    />
  );
}

describe('NameDialog — attribute slot', () => {
  it('renders the folderAttributes slot and forwards its value to onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkflowUIProvider client={client} slots={{ folderAttributes: DeptField }}>
        <NameDialog
          open
          title="New folder"
          label="Folder name"
          attributeSlot="folderAttributes"
          onSubmit={onSubmit}
          onClose={() => {}}
        />
      </WorkflowUIProvider>,
    );

    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Ops' } });
    fireEvent.change(screen.getByLabelText('department'), { target: { value: 'sales' } });
    fireEvent.click(screen.getByText('Create'));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Ops', { department: 'sales' }));
  });

  it('passes undefined attributes when no attributeSlot is configured', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkflowUIProvider client={client}>
        <NameDialog open title="New folder" label="Folder name" onSubmit={onSubmit} onClose={() => {}} />
      </WorkflowUIProvider>,
    );

    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Ops' } });
    fireEvent.click(screen.getByText('Create'));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Ops', undefined));
  });
});
