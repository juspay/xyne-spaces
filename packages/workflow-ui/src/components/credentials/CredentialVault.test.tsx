import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import type { CredentialAttributesDisplayProps } from '../../types/slots.js';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import { CredentialVault } from './CredentialVault.js';

const credential = {
  summary: {
    name: 'GitHub API',
    credType: 'BUILTIN_BEARER',
    authType: 'bearer' as const,
    status: 'ACTIVE' as const,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  },
  attributes: { createdBy: 'alice@example.com' },
  permittedActions: ['credential:read', 'credential:manage'],
};

const credentialTypes = [
  {
    connectorId: 'builtin',
    connectorName: 'Built-in',
    credentials: [
      {
        credType: 'BUILTIN_BEARER',
        label: 'Bearer Token',
        authType: 'bearer',
        fields: [{ key: 'token', label: 'Token', control: 'password' }],
      },
    ],
  },
  {
    connectorId: 'github',
    connectorName: 'GitHub',
    credentials: [
      {
        credType: 'GITHUB_WEBHOOK_SECRET',
        label: 'Webhook secret',
        description: 'Paste the same value into GitHub.',
        authType: 'secret',
        fields: [{ key: 'value', label: 'Secret', control: 'password' }],
      },
    ],
  },
];

function client(overrides: { create?: ReturnType<typeof vi.fn> } = {}): WorkflowClient {
  return {
    credentials: {
      list: vi.fn().mockResolvedValue({ credentials: [credential] }),
      create: overrides.create ?? vi.fn(),
    },
    schema: {
      credentialTypes: vi.fn().mockResolvedValue(credentialTypes),
    },
  } as unknown as WorkflowClient;
}

describe('CredentialVault host columns', () => {
  it('renders only generic columns when the host provides no slot', async () => {
    render(
      <WorkflowUIProvider client={client()}>
        <CredentialVault />
      </WorkflowUIProvider>,
    );

    expect(await screen.findByText('GitHub API')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Created by' })).not.toBeInTheDocument();
  });

  it('lets the host provide both an optional header and its row value', async () => {
    const HostCredentialColumns = (
      props: CredentialAttributesDisplayProps<{ createdBy?: string }>,
    ) =>
      props.mode === 'header' ? (
        <th>Created by</th>
      ) : (
        <td>{props.attributes?.createdBy ?? 'Unknown'}</td>
      );

    render(
      <WorkflowUIProvider
        client={client()}
        slots={{ credentialAttributesDisplay: HostCredentialColumns }}
      >
        <CredentialVault />
      </WorkflowUIProvider>,
    );

    expect(await screen.findByRole('columnheader', { name: 'Created by' })).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });
});

describe('CredentialVault credential types', () => {
  it('names each row by its credential type', async () => {
    render(
      <WorkflowUIProvider client={client()}>
        <CredentialVault />
      </WorkflowUIProvider>,
    );
    expect(await screen.findByText('Bearer Token')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();
  });

  it('creates a credential of the type chosen, grouped by connector', async () => {
    const create = vi.fn().mockResolvedValue({});
    const { baseElement } = render(
      <WorkflowUIProvider client={client({ create })}>
        <CredentialVault />
      </WorkflowUIProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /New credential/ }));
    expect(await screen.findByRole('region', { name: 'GitHub' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Webhook secret/ }));

    fireEvent.change(screen.getByPlaceholderText('e.g. stripe-prod'), { target: { value: 'gh-hook' } });
    const secretInput = baseElement.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(secretInput, { target: { value: 'shared' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create credential' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'gh-hook',
        credType: 'GITHUB_WEBHOOK_SECRET',
        values: { value: 'shared' },
      }),
    );
    // A webhook secret has no outbound call, so no offer to test it.
    expect(await screen.findByText('Credential created')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Test credential/ })).not.toBeInTheDocument();
  });
});
