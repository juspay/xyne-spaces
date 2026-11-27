// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DependencyGateHost } from './GateDialog';
import { dependencyConsent, type DependencyGateRefusal } from '../../../services/dependencies/gate';

const auth = vi.hoisted(() => ({
  user: { id: 'user', workspaceId: 'workspace' },
  isAuthenticated: true,
}));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../ui/Dialog', () => ({
  Dialog: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock('../../ui/Button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}));
const scope = () => JSON.stringify([auth.user.workspaceId, auth.user.id, 'ticket']);
async function flush(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}
// Mounted dialog/controller contract; identity and UI primitives are mocked, not application ACL/sync acceptance.
describe('private dependency consent dialog', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    auth.user = { id: 'user', workspaceId: 'workspace' };
    auth.isAuthenticated = true;
    dependencyConsent.cancel();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await flush(() => root.render(<DependencyGateHost />));
  });
  afterEach(async () => {
    await flush(() => root.unmount());
    container.remove();
    dependencyConsent.cancel();
    vi.unstubAllGlobals();
  });
  const open = async (gate: DependencyGateRefusal) => {
    let response!: Promise<unknown>;
    await flush(() => {
      response = dependencyConsent.ask(scope(), gate, new AbortController().signal);
    });
    return { response };
  };
  it('requires a private reason and never renders endpoint identities', async () => {
    const { response } = await open({ softCount: 2, hardCount: 0, canAdminOverride: false });
    const textarea = container.querySelector('textarea')!;
    expect(textarea.classList.contains('ph-no-capture')).toBe(true);
    expect(textarea.maxLength).toBe(2000);
    expect(container.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    expect(container.textContent).toContain('2 soft dependencies');
    await flush(() => container.querySelector<HTMLButtonElement>('button[type=button]')!.click());
    expect(await response).toBeNull();
  });
  it('does not offer reason or consent to an ineligible hard override', async () => {
    const { response } = await open({ softCount: 0, hardCount: 1, canAdminOverride: false });
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('input[type=checkbox]')).toBeNull();
    expect(container.querySelector('button[type=submit]')).toBeNull();
    await flush(() => dependencyConsent.cancel());
    expect(await response).toBeNull();
  });
  it('eligible hard gates require an explicit unchecked administrator consent', async () => {
    await open({ softCount: 0, hardCount: 1, canAdminOverride: true });
    expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  });
  it('workspace replacement closes the old request and resolves without consent', async () => {
    const { response } = await open({ softCount: 1, hardCount: 0, canAdminOverride: false });
    await flush(() => {
      auth.user = { ...auth.user, workspaceId: 'replacement' };
      root.render(<DependencyGateHost />);
    });
    expect(await response).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });
  it('unmount cancels the pending move', async () => {
    const { response } = await open({ softCount: 1, hardCount: 0, canAdminOverride: false });
    await flush(() => root.render(null));
    expect(await response).toBeNull();
  });
});
