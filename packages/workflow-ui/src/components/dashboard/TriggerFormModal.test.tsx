/**
 * The run form has two shapes, and which one it takes is decided by the schema:
 * a sectioned schema gets the full-page form (collapsible sections, two-up
 * rows); anything else gets the centered dialog. A full-screen takeover for
 * three inputs was the regression this guards.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import { TriggerFormModal } from './TriggerFormModal.js';

const makeClient = () => ({ baseUrl: 'http://localhost' }) as unknown as WorkflowClient;

function openWith(inputSchema: Record<string, unknown> | undefined) {
  const { container } = render(
    React.createElement(WorkflowUIProvider, {
      client: makeClient(),
      children: React.createElement(TriggerFormModal, {
        inputSchema,
        workflowName: 'My Flow',
        onSubmit: vi.fn(async () => {}),
        onClose: vi.fn(),
      }),
    }),
  );
  // The provider wraps its children in a theme-scoping div, so reach the
  // modal shell by its own positioning rather than by position in the tree.
  const shell = container.querySelector('div.fixed') as HTMLElement;
  const panel = shell.children[1] as HTMLElement; // [backdrop, panel]
  return { shell, panel };
}

const isFullPage = (panel: HTMLElement) => panel.className.includes('h-full');
const isDialog = (panel: HTMLElement) => panel.className.includes('max-w-lg');

const threeFields = {
  type: 'object',
  properties: { name: { type: 'string' }, email: { type: 'string' }, note: { type: 'string' } },
};

describe('TriggerFormModal — full page only when the schema defines sections', () => {
  it('an unsectioned schema opens the centered dialog', () => {
    const { shell, panel } = openWith(threeFields);
    expect(isDialog(panel)).toBe(true);
    expect(isFullPage(panel)).toBe(false);
    expect(shell.className).toContain('items-center');
    // The fields still render — flat, with no section header to expand.
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    expect(screen.queryByRole('button', { expanded: true })).toBeNull();
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
  });

  it('a sectioned schema opens the full-page form', () => {
    const { shell, panel } = openWith({
      ...threeFields,
      'x-layout': [
        { title: 'Who', fields: ['name', 'email'] },
        { title: 'Details', fields: ['note'] },
      ],
    });
    expect(isFullPage(panel)).toBe(true);
    expect(isDialog(panel)).toBe(false);
    expect(shell.className).not.toContain('items-center');
    expect(screen.getByText('Who')).toBeTruthy();
    expect(screen.getByText('Details')).toBeTruthy();
  });

  it('a layout with no titles is not a section, so it stays a dialog', () => {
    // `layoutToSchemaValue` declines to even write a single untitled group —
    // the predicate here has to agree with that notion of "unsectioned".
    const { panel } = openWith({ ...threeFields, 'x-layout': [{ fields: ['name', 'email', 'note'] }] });
    expect(isDialog(panel)).toBe(true);
  });

  it('nothing to collect stays a dialog rather than a blank full page', () => {
    const { panel } = openWith(undefined);
    expect(isDialog(panel)).toBe(true);
    expect(screen.getByText(/No input is required/)).toBeTruthy();
  });
});

// ─── Run naming: the identifier field and its checks ───

describe('TriggerFormModal run naming', () => {
  it('starts empty and submits the typed name separately from form fields', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TriggerFormModal
        workflowName="Customer Verification"
        runNaming={{ mode: 'user' }}
        onSubmit={onSubmit}
        onClose={() => undefined}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Workflow run identifier' });
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Rahul KYC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ __runIdentifier: 'Rahul KYC' });
    });
  });

  it('keeps the form open and shows a duplicate-name error', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Workflow run identifier "Review" already exists'));
    render(
      <TriggerFormModal
        workflowName="Review"
        runNaming={{ mode: 'user' }}
        onSubmit={onSubmit}
        onClose={() => undefined}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Workflow run identifier' }), {
      target: { value: 'Review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByText('This is the same as the workflow name')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Workflow run identifier "Review" already exists')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Workflow run identifier' })).toBeInTheDocument();
  });

  it('confirms an empty name before submitting it for automatic naming', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TriggerFormModal
        workflowName="Customer Verification"
        runNaming={{ mode: 'user' }}
        onSubmit={onSubmit}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(screen.getByText('No run name was entered')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    // The check carries its own buttons; the form's Run/Cancel bar is hidden.
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ __runIdentifier: '' }));
  });
});

describe('TriggerFormModal — the blank-name check', () => {
  it('goes back to the form, keeping the name field, without running', () => {
    const onSubmit = vi.fn();
    render(<TriggerFormModal runNaming={{ mode: 'user' }} onSubmit={onSubmit} onClose={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(screen.getByRole('textbox', { name: 'Workflow run identifier' })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
