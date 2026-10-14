// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PollComposerDialog, resolvePollScheduleTime } from './PollComposerDialog';

// Stub the Radix dialog (its module graph needs app globals); the dismiss
// button stands in for Escape / outside click.
vi.mock('../../ui/Dialog/Dialog', () => {
  const Dialog = ({
    open,
    title,
    onOpenChange,
    children,
  }: {
    open: boolean;
    title?: string;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) =>
    open ? (
      <div>
        <button
          type='button'
          data-track-category='TEST'
          data-track-name='DISMISS'
          onClick={() => onOpenChange?.(false)}
        >
          Dismiss {title}
        </button>
        {children}
      </div>
    ) : null;
  return { Dialog, default: Dialog };
});

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
      root.render(<PollComposerDialog open onClose={vi.fn()} onPublish={onPublish} />);
    });

    const inputs = [...container.querySelectorAll('input')];
    act(() => {
      setInputValue(inputs.find(input => input.placeholder === 'Write your question…')!, 'Lunch?');
      setInputValue(inputs.find(input => input.placeholder === 'Option 1')!, 'Yes');
      setInputValue(inputs.find(input => input.placeholder === 'Option 2')!, 'No');
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

  it('keeps Preview enabled and marks empty inputs when the draft is incomplete', () => {
    act(() => {
      root.render(<PollComposerDialog open onClose={vi.fn()} onPublish={vi.fn()} />);
    });
    const inputs = [...container.querySelectorAll('input')];
    act(() => {
      setInputValue(inputs.find(input => input.placeholder === 'Write your question…')!, 'Lunch?');
      setInputValue(inputs.find(input => input.placeholder === 'Option 1')!, 'Yes');
    });

    act(() => clickButton(container, 'Preview'));

    expect(container.textContent).toContain('Fill in this option or remove it');
    expect(container.querySelector('[placeholder="Option 2"]')?.getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(container.textContent).not.toContain('Post poll');
  });

  it('asks before Escape or an outside click discards a typed draft', async () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<PollComposerDialog open onClose={onClose} onPublish={vi.fn()} />);
    });
    act(() => {
      setInputValue(
        container.querySelector('[placeholder="Write your question…"]') as HTMLInputElement,
        'Lunch?',
      );
    });

    await act(async () => {
      clickButton(container, 'Dismiss Create a poll');
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Discard this poll?');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      clickButton(container, 'Discard');
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft open when publication fails', async () => {
    const onPublish = vi.fn().mockRejectedValue(new Error('Unavailable'));
    act(() => {
      root.render(<PollComposerDialog open onClose={vi.fn()} onPublish={onPublish} />);
    });
    const inputs = [...container.querySelectorAll('input')];
    act(() => {
      setInputValue(inputs.find(input => input.placeholder === 'Write your question…')!, 'Keep me');
      setInputValue(inputs.find(input => input.placeholder === 'Option 1')!, 'One');
      setInputValue(inputs.find(input => input.placeholder === 'Option 2')!, 'Two');
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
