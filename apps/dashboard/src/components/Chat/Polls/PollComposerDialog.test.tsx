// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PollComposerDialog, resolvePollScheduleTime } from './PollComposerDialog';

vi.mock('../../ui/Dialog', () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
}));

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.bind(
    input,
  );
  setter?.(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const clickButton = (container: HTMLElement, label: string): void => {
  const button = [...container.querySelectorAll('button')].find(
    candidate => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('PollComposerDialog current-context flow', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('publishes in the current context without a distribution or comments control', async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined);
    act(() => {
      root.render(
        <PollComposerDialog
          open
          activeChannelId='channel-1'
          isPublishing={false}
          onClose={vi.fn()}
          onPublish={onPublish}
        />,
      );
    });

    const inputs = [...container.querySelectorAll('input')];
    act(() => {
      setInputValue(inputs.find(input => input.placeholder === 'Write your question…')!, 'Lunch?');
      setInputValue(inputs.find(input => input.placeholder === 'Choice 1')!, 'Yes');
      setInputValue(inputs.find(input => input.placeholder === 'Choice 2')!, 'No');
    });
    expect(container.textContent).not.toContain('Allow comments');
    expect(container.textContent).not.toContain('Poll Distribution');
    expect(container.textContent).not.toContain('Pre-fill');

    act(() => clickButton(container, 'Preview'));
    await act(async () => {
      clickButton(container, 'Post poll');
      await Promise.resolve();
    });

    expect(onPublish).toHaveBeenCalledWith(
      expect.objectContaining({ questions: [expect.objectContaining({ question: 'Lunch?' })] }),
      { publishAt: null, closeAt: null, remindAt: null },
    );
  });

  it('keeps the draft open when publication fails', async () => {
    const onPublish = vi.fn().mockRejectedValue(new Error('Unavailable'));
    act(() => {
      root.render(
        <PollComposerDialog
          open
          activeChannelId='channel-1'
          isPublishing={false}
          onClose={vi.fn()}
          onPublish={onPublish}
        />,
      );
    });
    const inputs = [...container.querySelectorAll('input')];
    act(() => {
      setInputValue(inputs.find(input => input.placeholder === 'Write your question…')!, 'Keep me');
      setInputValue(inputs.find(input => input.placeholder === 'Choice 1')!, 'One');
      setInputValue(inputs.find(input => input.placeholder === 'Choice 2')!, 'Two');
    });
    act(() => clickButton(container, 'Preview'));
    await act(async () => {
      clickButton(container, 'Post poll');
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Unavailable');
    act(() => clickButton(container, 'Back'));
    expect(
      (container.querySelector('[placeholder="Write your question…"]') as HTMLInputElement).value,
    ).toBe('Keep me');
  });
});

describe('resolvePollScheduleTime', () => {
  it('supports preset and custom timing', () => {
    expect(resolvePollScheduleTime('30', null, 1_000)).toBe(
      new Date(1_000 + 30 * 60_000).toISOString(),
    );
    const custom = new Date('2026-10-08T12:00:00.000Z');
    expect(resolvePollScheduleTime('CUSTOM', custom, 1_000)).toBe(custom.toISOString());
  });
});
