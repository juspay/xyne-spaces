import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { WorkflowUIProvider } from './WorkflowUIProvider.js';
import { useWorkflowUI } from './workflow-ui-context.js';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';

function mockClient(): WorkflowClient {
  return {
    schema: {
      steps: vi.fn(),
      step: vi.fn(),
      triggers: vi.fn(),
      trigger: vi.fn(),
      operators: vi.fn(),
      availableContext: vi.fn(),
    },
    workflows: {
      list: vi.fn(),
      get: vi.fn(),
      validate: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      trigger: vi.fn(),
    },
    executions: {
      list: vi.fn(),
      get: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    },
    credentials: {
      list: vi.fn(),
      create: vi.fn(),
    },
  } as unknown as WorkflowClient;
}

describe('WorkflowUIProvider', () => {
  it('renders children', () => {
    render(
      <WorkflowUIProvider client={mockClient()}>
        <div data-testid="child">Hello</div>
      </WorkflowUIProvider>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('provides the client via context', () => {
    const client = mockClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkflowUIProvider client={client}>{children}</WorkflowUIProvider>
    );

    const { result } = renderHook(() => useWorkflowUI(), { wrapper });

    expect(result.current.client).toBe(client);
  });

  it('throws when useWorkflowUI is used outside provider', () => {
    expect(() => {
      renderHook(() => useWorkflowUI());
    }).toThrow('useWorkflowUI must be used within a <WorkflowUIProvider>');
  });

  it('sets data-workflow-ui attribute for CSS token scoping', () => {
    render(
      <WorkflowUIProvider client={mockClient()}>
        <span>test</span>
      </WorkflowUIProvider>,
    );
    const container = document.querySelector('[data-workflow-ui]');
    expect(container).not.toBeNull();
  });

  it('passes slots and classNames through context', () => {
    const CustomStepNode = () => <div />;
    const client = mockClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkflowUIProvider
        client={client}
        slots={{ StepNode: CustomStepNode }}
        classNames={{ canvas: 'bg-black' }}
      >
        {children}
      </WorkflowUIProvider>
    );

    const { result } = renderHook(() => useWorkflowUI(), { wrapper });

    expect(result.current.slots['StepNode']).toBe(CustomStepNode);
    expect(result.current.classNames['canvas']).toBe('bg-black');
  });
});
