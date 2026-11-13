import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import type { CredentialSummary } from '@xyne/workflow-sdk/common';
import { CredentialDropdown } from './CredentialDropdown.js';

// ─── Fixtures ───

const cred = (over: Partial<CredentialSummary> = {}): CredentialSummary => ({
  name: 'c1',
  credType: 'BUILTIN_BEARER',
  authType: 'bearer',
  status: 'ACTIVE',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

/**
 * A mock WorkflowClient whose `credentials.list()` resolves to the given
 * summaries. Only `credentials` is exercised by the dropdown; the rest are
 * stubbed to satisfy the type.
 */
function makeClient(credentials: CredentialSummary[]): WorkflowClient {
  return {
    baseUrl: 'http://localhost',
    schema: {} as WorkflowClient['schema'],
    credentials: {
      list: vi.fn().mockResolvedValue({
        credentials: credentials.map((summary) => ({ summary })),
      }),
      create: vi.fn(),
      replaceValues: vi.fn(),
      revoke: vi.fn(),
    } as unknown as WorkflowClient['credentials'],
    workflows: {} as WorkflowClient['workflows'],
    executions: {} as WorkflowClient['executions'],
    analytics: {} as WorkflowClient['analytics'],
    uploads: {} as WorkflowClient['uploads'],
  } as unknown as WorkflowClient;
}

function renderDropdown(opts: {
  credentials: CredentialSummary[];
  value?: string;
  onChange?: (n: string) => void;
  readOnly?: boolean;
  accepts?: readonly string[];
}) {
  const onChange = opts.onChange ?? vi.fn();
  render(
    <WorkflowUIProvider client={makeClient(opts.credentials)}>
      <CredentialDropdown
        value={opts.value ?? ''}
        onChange={onChange}
        readOnly={opts.readOnly}
        accepts={opts.accepts}
      />
    </WorkflowUIProvider>,
  );
  return { onChange };
}

/** The trigger button (aria-label defaults to "Credential"). */
const trigger = () => screen.getByRole('button', { name: 'Credential' });

// ─── Tests ───

describe('CredentialDropdown', () => {
  it('lists active credential names plus the empty Select option', async () => {
    renderDropdown({
      credentials: [
        cred({ name: 'stripe', authType: 'bearer' }),
        cred({ name: 'gh', authType: 'custom_header' }),
      ],
    });
    fireEvent.click(trigger());

    expect(await screen.findByRole('option', { name: 'stripe' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'gh' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Select/ })).toBeTruthy();
  });

  it('always offers the empty Select option when the list is empty', async () => {
    renderDropdown({ credentials: [] });
    fireEvent.click(trigger());
    expect(
      await screen.findByRole('option', { name: /Select/ }),
    ).toBeTruthy();
  });

  it('calls onChange with the credential name when one is selected', async () => {
    const { onChange } = renderDropdown({
      credentials: [cred({ name: 'stripe' })],
    });
    fireEvent.click(trigger());
    fireEvent.click(
      await screen.findByRole('option', { name: /stripe/ }),
    );
    expect(onChange).toHaveBeenCalledWith('stripe');
  });

  it('calls onChange with "" when Select is chosen', async () => {
    const { onChange } = renderDropdown({
      credentials: [cred({ name: 'stripe' })],
      value: 'stripe',
    });
    fireEvent.click(trigger());
    fireEvent.click(
      await screen.findByRole('option', { name: /Select/ }),
    );
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('filters the options by credential name', async () => {
    renderDropdown({
      credentials: [
        cred({ name: 'GitHub Production' }),
        cred({ name: 'Stripe Test' }),
      ],
    });
    fireEvent.click(trigger());
    await screen.findByRole('option', { name: 'GitHub Production' });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search credentials' }), {
      target: { value: 'stripe' },
    });

    expect(screen.getByRole('option', { name: 'Stripe Test' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'GitHub Production' })).toBeNull();
  });

  it('does not offer a revoked credential as a selectable option', async () => {
    renderDropdown({
      credentials: [
        cred({ name: 'old', status: 'REVOKED' }),
        cred({ name: 'live', status: 'ACTIVE' }),
      ],
    });
    fireEvent.click(trigger());
    // Wait for load to settle by asserting the active one appears first.
    expect(await screen.findByRole('option', { name: /live/ })).toBeTruthy();
    // The revoked credential is not the current value, so it is not listed.
    expect(screen.queryByRole('option', { name: /old/ })).toBeNull();
  });

  it('preserves a revoked current selection as a disabled "revoked" row', async () => {
    renderDropdown({
      credentials: [cred({ name: 'old', status: 'REVOKED' })],
      value: 'old',
    });
    // Trigger reflects the unavailable selection.
    await waitFor(() => {
      expect(trigger().textContent).toMatch(/old.*revoked/i);
    });

    fireEvent.click(trigger());
    const row = (await screen.findByRole('option', {
      name: /old.*revoked/i,
    })) as HTMLButtonElement;
    // Present but non-interactive.
    expect(row.disabled).toBe(true);
  });

  it('disables the trigger in read-only mode', async () => {
    renderDropdown({ credentials: [cred()], readOnly: true });
    await act(async () => {});
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
  });
  it('offers only credentials of the accepted types', async () => {
    renderDropdown({
      credentials: [
        cred({ name: 'gh-secret', credType: 'GITHUB_WEBHOOK_SECRET', authType: 'secret' }),
        cred({ name: 'plain-secret', credType: 'SLACK_SIGNING_SECRET', authType: 'secret' }),
        cred({ name: 'token', credType: 'BUILTIN_BEARER' }),
      ],
      accepts: ['GITHUB_WEBHOOK_SECRET'],
    });
    await act(async () => {
      fireEvent.click(trigger());
    });

    expect(await screen.findByRole('option', { name: 'gh-secret' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'plain-secret' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'token' })).not.toBeInTheDocument();
  });

  it('says so when no credential of an accepted type exists', async () => {
    renderDropdown({ credentials: [cred({ name: 'token' })], accepts: ['GITHUB_WEBHOOK_SECRET'] });
    await act(async () => {
      fireEvent.click(trigger());
    });
    expect(await screen.findByText(/No credentials of the right type yet/)).toBeInTheDocument();
  });

  it('marks a selection whose type the field no longer accepts', async () => {
    renderDropdown({
      credentials: [cred({ name: 'token', credType: 'BUILTIN_BEARER' })],
      value: 'token',
      accepts: ['GITHUB_WEBHOOK_SECRET'],
    });
    await waitFor(() => expect(trigger()).toHaveTextContent('token (wrong type)'));
  });
});
