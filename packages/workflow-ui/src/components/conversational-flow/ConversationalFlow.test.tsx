/**
 * Build and Test, driven the way an author uses them, on the real support flow.
 * What Build saves is read back and checked — the editor is only right if the
 * config it hands to `onSave` says what the map showed.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { QUIET_MS } from './use-autosave.js';
import React from 'react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import { WorkflowUIProvider } from '../provider/WorkflowUIProvider.js';
import { ConfigValidator, ConnectorRegistry } from '@xyne/workflow-sdk';
import { ConversationalFlowEditor } from './ConversationalFlowEditor.js';
import { ConversationalFlowTest } from './test/ConversationalFlowTest.js';
import { optionsOf, readConversationalFlow, scopeOf, type ConversationStreamEvent, type Turn } from '@xyne/workflow-sdk/conversational-flow';
import agentFlow from './__fixtures__/support-tree.json' with { type: 'json' };

const config = agentFlow as unknown as WorkflowConfig;

function withClient(client: Partial<WorkflowClient>, node: React.ReactNode) {
  return render(
    React.createElement(WorkflowUIProvider, { client: client as WorkflowClient, children: node }),
  );
}

function renderEditor() {
  const onSave = vi.fn(async (_c: WorkflowConfig) => {});
  // The classifier's Service field lists the workspace's credentials.
  const credentials = { list: vi.fn(async () => ({ credentials: [{ summary: { name: 'Jev', credType: 'BUILTIN_ENDPOINT_KEY', status: 'ACTIVE' } }] })) };
  withClient({ credentials } as unknown as Partial<WorkflowClient>, <ConversationalFlowEditor initialConfig={config} onSave={onSave} />);
  return { onSave };
}

/** A card by its accessible name — "<type>: <title>" — the way a screen reader finds it. */
const card = (title: string) => {
  const node = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].find(
    (el) => el.getAttribute('aria-label')?.split(': ').slice(1).join(': ') === title,
  );
  if (!node) throw new Error(`no card "${title}" on the map`);
  return node;
};
const inspector = (title: string) => screen.getByRole('complementary', { name: `Screen: ${title}` });

/**
 * Save now. The editor saves on its own after a quiet period, so a test that
 * wants the config without waiting presses what a person would: ⌘S.
 */
const saveNow = () => { fireEvent.keyDown(window, { key: 's', metaKey: true }); };

/**
 * Put text in a message box.
 *
 * The box is CodeMirror, so there is no value to set — the text goes in as a
 * transaction, and the blur is what commits it, exactly as a person's would.
 */
function write(box: HTMLElement, text: string): void {
  const editor = EditorView.findFromDOM(box.parentElement as HTMLElement);
  if (!editor) throw new Error('no editor found for that box');
  act(() => {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  });
  fireEvent.blur(box);
}

describe('Build — the map', () => {
  it('draws the first two levels, with deeper branches folded', () => {
    renderEditor();
    for (const title of ['Support', 'Rides', 'Payments', 'Account', 'Charges']) expect(card(title)).toBeTruthy();
    // Depth 3 is folded away: its card says what it hides.
    expect(within(card('Charges')).getByText(/screens? beneath/)).toBeTruthy();
    expect(() => card('Charged twice')).toThrow();
  });

  it('writes the way back on the cards instead of drawing it', () => {
    renderEditor();
    expect(within(card('Charges')).getByText('↑ Payments')).toBeTruthy();
  });

  it('shows how typed messages are handled, and opens the router from it', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /If they type instead of tapping/ }));
    expect(inspector('Route typed text')).toBeTruthy();
  });

  it('picks the router’s agent with the agent step’s own picker', async () => {
    const fieldOptions = vi.fn(async () => ({ items: [{ value: 'ask-ai', label: 'Ask AI agent' }] }));
    withClient({ schema: { fieldOptions } } as unknown as Partial<WorkflowClient>, <ConversationalFlowEditor workflowId="wf-1" initialConfig={config} />);
    fireEvent.click(screen.getByRole('button', { name: /If they type instead of tapping/ }));
    const panel = inspector('Route typed text');
    expect(await within(panel).findByText('Ask AI agent')).toBeTruthy();
    expect(fieldOptions).toHaveBeenCalledWith(expect.objectContaining({ kind: 'steps', type: 'RUN_AGENT', field: 'agentSlug', workflowId: 'wf-1' }));
  });

  it('switches the router to a classifier model and configures it', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /If they type instead of tapping/ }));
    const panel = () => inspector('Route typed text');

    fireEvent.click(within(panel()).getByRole('radio', { name: 'Classifier model' }));
    expect(within(panel()).getByText(/a classifier model reads the message/)).toBeTruthy();

    const model = within(panel()).getByLabelText('Model');
    fireEvent.change(model, { target: { value: 'jev-latest' } });
    fireEvent.blur(model);
    // Unsure messages go back to the first screen instead of a guess.
    fireEvent.click(within(panel()).getByRole('switch'));

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const router = saved.screens.find((s) => s.kind === 'router')!.router!;
    expect(router).toMatchObject({ mode: 'classifier', model: 'jev-latest', minConfidence: 0.5 });
    expect(router.candidates.length).toBeGreaterThan(0);
  });

  it('opens a branch when its card is unfolded', () => {
    renderEditor();
    fireEvent.click(within(card('Charges')).getByText(/screens? beneath/));
    expect(card('Ride charges')).toBeTruthy();
  });
});

describe('the fixture these tests are written against', () => {
  it('is a flow the editor could have produced', () => {
    // This file is a copy of the SDK package's fixture. Nothing in the repo
    // keeps the two in step, so a migration applied to one can silently miss
    // this one — which is what happened when follow-up questions were removed,
    // leaving options here that led nowhere. Assert the property rather than
    // byte-equality: what matters is that it is a flow the editor can author.
    const flow = readConversationalFlow(config)!;
    const dangling = flow.screens.flatMap((s) =>
      optionsOf(s)
        .filter((o) => o.to.kind === 'none')
        .map((o) => `${s.id} → “${o.label}”`),
    );
    expect(dangling).toEqual([]);
  });
});

describe('Build — saving on its own', () => {
  it('saves a change without the button being pressed', async () => {
    vi.useFakeTimers();
    try {
      const { onSave } = renderEditor();
      fireEvent.click(card('Payments'));
      const message = within(inspector('Payments')).getByLabelText('What the assistant says');
      write(message, 'Payments — what\u2019s up?');

      // Nothing yet: it waits for the author to stop.
      await act(async () => { await vi.advanceTimersByTimeAsync(QUIET_MS - 1); });
      expect(onSave).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(onSave).toHaveBeenCalledTimes(1);
      const saved = readConversationalFlow(onSave.mock.calls[0]![0])!;
      expect(saved.screens.find((s) => s.id === 'payments')!.prompts[0]!.says[0]).toBe('Payments — what\u2019s up?');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a read-only editor alone', async () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn(async (_c: WorkflowConfig) => {});
      withClient({} as unknown as Partial<WorkflowClient>,
        <ConversationalFlowEditor initialConfig={config} onSave={onSave} readOnly />);
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(onSave).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Build — what the header says about saving', () => {
  const editPayments = () => {
    fireEvent.click(card('Payments'));
    const box = within(inspector('Payments')).getByLabelText('What the assistant says');
    write(box, 'Changed.');
  };

  it('says it is saving, then that it is saved — and offers nothing to press', async () => {
    vi.useFakeTimers();
    try {
      renderEditor();
      expect(screen.getByText('Saved')).toBeTruthy();

      editPayments();
      // It saves itself, so it says so rather than asking to be pressed.
      expect(screen.getByText('Saving…')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();

      await act(async () => { await vi.advanceTimersByTimeAsync(QUIET_MS); });
      expect(screen.getByText('Saved')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('becomes something to press only when a save failed', async () => {
    vi.useFakeTimers();
    try {
      let fail = true;
      const onSave = vi.fn(async (_c: WorkflowConfig) => { if (fail) throw new Error('offline'); });
      withClient({} as unknown as Partial<WorkflowClient>, <ConversationalFlowEditor initialConfig={config} onSave={onSave} />);
      editPayments();
      await act(async () => { await vi.advanceTimersByTimeAsync(QUIET_MS); });

      // Autosave does not retry, so the author is given a way to.
      const retry = screen.getByRole('button', { name: /Not saved — retry/ });
      expect(screen.getByRole('alert').textContent).toContain('offline');

      fail = false;
      await act(async () => { fireEvent.click(retry); });
      expect(screen.getByText('Saved')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Not saved/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the button for a host that turns autosave off', () => {
    const onSave = vi.fn(async (_c: WorkflowConfig) => {});
    withClient({} as unknown as Partial<WorkflowClient>,
      <ConversationalFlowEditor initialConfig={config} onSave={onSave} autosave={false} />);
    editPayments();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByText('Saving…')).toBeNull();
  });
});

describe('Build — editing', () => {
  it('opens a screen in the inspector and saves a changed message', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Payments'));
    const panel = inspector('Payments');
    const message = within(panel).getByLabelText('What the assistant says');
    write(message, 'Payments — what’s up?');

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = readConversationalFlow(onSave.mock.calls[0]![0])!;
    expect(saved.screens.find((s) => s.id === 'payments')!.prompts[0]!.says[0]).toBe('Payments — what’s up?');
  });

  it('says several things on one screen, and takes one back', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Payments'));
    const panel = () => inspector('Payments');
    const says = () => readConversationalFlow(onSave.mock.calls.at(-1)![0])!
      .screens.find((s) => s.id === 'payments')!.prompts[0]!.says;

    fireEvent.click(within(panel()).getByRole('button', { name: '+ Message' }));
    const second = within(panel()).getByLabelText('What the assistant says \u2014 message 2 of 2');
    write(second, 'What would you like to do?');

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(says()).toHaveLength(2);
    expect(says()[1]).toBe('What would you like to do?');

    // And removing one leaves the other, with a single box again.
    fireEvent.click(within(panel()).getByRole('button', { name: 'Remove message 2' }));
    saveNow();
    await vi.waitFor(() => expect(says()).toHaveLength(1));
    expect(within(panel()).queryByRole('button', { name: /Remove message/ })).toBeNull();
  });

  it('turns the way back off from the panel, and on again', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Charges'));
    const panel = () => inspector('Charges');
    const toggle = () => within(panel()).getByRole('switch', { name: /Offer the way back/ });

    expect((toggle() as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle());
    // It used to throw "There is no question …" here and change nothing.
    expect(screen.queryByRole('alert')).toBeNull();
    expect((toggle() as HTMLInputElement).checked).toBe(false);

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const charges = saved.screens.find((s) => s.id === 'payments_charges')!;
    expect(charges.prompts.flatMap((p) => p.options).filter((o) => o.back)).toEqual([]);
  });

  it('inserts a screen into the path above another, and opens it', async () => {
    const { onSave } = renderEditor();

    // It is something you add, so it lives under the card's + menu.
    fireEvent.click(within(card('Payments')).getByRole('button', { name: 'Add to Payments' }));
    const menu = screen.getByRole('menu', { name: 'Add to Payments' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Insert a screen above/ }));

    // It lands selected, so it can be named straight away.
    const panel = inspector('New screen');
    expect(panel).toBeTruthy();

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const added = saved.screens.find((s) => s.title === 'New screen')!;
    const payments = saved.screens.find((s) => s.id === 'payments')!;
    const leads = (id: string) =>
      saved.screens.find((s) => s.id === id)!.prompts
        .flatMap((p) => p.options)
        .filter((o) => !o.back && o.to.kind === 'screen')
        .map((o) => (o.to as { screen: string }).screen);

    // Payments is now reached through the new screen, not from its old parent.
    expect(payments.parent).toBe(added.id);
    expect(leads(added.id)).toContain('payments');
    expect(leads(added.parent!)).toContain(added.id);
    expect(leads(added.parent!)).not.toContain('payments');
  });

  it('adds a screen beneath, of a chosen type, and opens it', () => {
    renderEditor();
    fireEvent.click(card('Payments'));
    fireEvent.click(within(inspector('Payments')).getByRole('button', { name: /New screen beneath/ }));
    const title = screen.getByLabelText(/New screen beneath “Payments”/);
    const form = title.closest('form')!;
    fireEvent.change(title, { target: { value: 'Promo codes' } });
    fireEvent.click(within(form).getByRole('radio', { name: /Ask AI/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add screen' }));

    const panel = inspector('Promo codes');
    // The badge beside the title says what it is; the settings row says it too.
    expect(within(panel.querySelector('header')!).getByText('Ask AI')).toBeTruthy();
    expect(card('Promo codes')).toBeTruthy();
  });

  it('adds a Hand off screen, which the saved flow reads as one', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Payments'));
    fireEvent.click(within(inspector('Payments')).getByRole('button', { name: /New screen beneath/ }));
    const title = screen.getByLabelText(/New screen beneath “Payments”/);
    const form = title.closest('form')!;
    fireEvent.change(title, { target: { value: 'Talk to a person' } });
    fireEvent.click(within(form).getByRole('radio', { name: /Hand off/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add screen' }));

    expect(within(inspector('Talk to a person')).getByText(/A person takes the conversation here/)).toBeTruthy();
    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = readConversationalFlow(onSave.mock.calls[0]![0])!;
    expect(saved.screens.find((s) => s.title === 'Talk to a person')!.kind).toBe('handoff');
  });

    it('blocks typing on a screen, so only its options can answer it', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Payments'));
    const panel = () => inspector('Payments');
    const toggle = within(panel()).getByRole('switch', { name: /Let them type/ });
    expect((toggle as HTMLInputElement).checked).toBe(true);

    fireEvent.click(toggle);
    expect(within(panel()).getByText('They can only choose an option here')).toBeTruthy();

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const payments = saved.screens.find((s) => s.id === 'payments')!;
    expect(payments.prompts[0]!.textField).toBeUndefined();
    expect(payments.prompts[0]!.options.length).toBeGreaterThan(0);
  });

  it('moves a section somewhere else, offering only what has room', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Past rides'));
    const panel = () => inspector('Past rides');
    const picker = () => within(panel()).getByLabelText('Inside') as HTMLSelectElement;

    expect(picker().value).toBe('rides');
    // Only a Menu can hold a screen, and nothing can be put inside itself.
    const offered = [...picker().options].map((o) => o.value);
    expect(offered).toContain('account');
    expect(offered).not.toContain('rides_cancel');
    expect(offered).not.toContain('done');
    expect(offered).not.toContain('rides_past');

    fireEvent.change(picker(), { target: { value: 'account' } });
    expect(screen.queryByRole('alert')).toBeNull();

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    expect(saved.screens.find((s) => s.id === 'rides_past')!.parent).toBe('account');
    // What was inside it came along, and its way back goes where it is now
    // rather than back up the branch it used to be on.
    const inside = saved.screens.find((s) => s.id === 'rides_lost_item')!;
    expect(inside.parent).toBe('rides_past');
    expect(
      optionsOf(inside)
        .filter((o) => o.back)
        .map((o) => (o.to.kind === 'screen' ? o.to.screen : '?')),
    ).toEqual(['rides_past', 'account', 'root']);
  });

  it('asks what becomes of a section\u2019s contents instead of refusing', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Past rides'));
    fireEvent.click(within(inspector('Past rides')).getByRole('radio', { name: /Message/ }));

    const ask = screen.getByRole('dialog');
    expect(within(ask).getByText(/holds 2 screens/)).toBeTruthy();
    fireEvent.click(within(ask).getByRole('radio', { name: /Move them up to/ }));
    fireEvent.click(within(ask).getByRole('button', { name: 'Change to Message' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    expect(saved.screens.find((s) => s.id === 'rides_past')!.kind).toBe('message');
    // Out of it, into where it sat, and still reachable by tapping.
    const rides = saved.screens.find((s) => s.id === 'rides')!;
    for (const id of ['rides_receipt', 'rides_lost_item']) {
      expect(saved.screens.find((s) => s.id === id)!.parent).toBe('rides');
      expect(optionsOf(rides).some((o) => o.to.kind === 'screen' && o.to.screen === id)).toBe(true);
    }
  });

  it('counts the whole subtree when the answer is to delete it', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Payments'));
    fireEvent.click(within(inspector('Payments')).getByRole('radio', { name: 'Finish' }));

    const ask = screen.getByRole('dialog');
    // Everything beneath it, not the handful it offers directly.
    expect(within(ask).getByText(/holds 27 screens/)).toBeTruthy();
    fireEvent.click(within(ask).getByRole('radio', { name: /Delete all 27 screens/ }));
    fireEvent.click(within(ask).getByRole('button', { name: 'Change to Finish' }));

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    expect(saved.screens.find((s) => s.id === 'payments')!.kind).toBe('end');
    expect(saved.screens.find((s) => s.id === 'payments_double_charge')).toBeUndefined();
  });

  it('selects the choice the picker belongs to, and only that one', () => {
    renderEditor();
    fireEvent.click(card('Past rides'));
    fireEvent.click(within(inspector('Past rides')).getByRole('radio', { name: /Message/ }));

    const ask = screen.getByRole('dialog');
    const picked = (name: RegExp) => within(ask).getByRole('radio', { name }).getAttribute('aria-checked');
    expect(picked(/Move them up to/)).toBe('true');

    fireEvent.change(within(ask).getByLabelText('Move into'), { target: { value: 'account' } });
    // Picking a destination moves the selection onto that choice — it used to
    // only drop the outline on the one being left, which read as nothing.
    expect(picked(/Move into another screen/)).toBe('true');
    expect(picked(/Move them up to/)).toBe('false');
    expect(picked(/Delete all/)).toBe('false');
  });

  it('offers the same choice when a section is removed', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Rides'));
    fireEvent.click(within(inspector('Rides')).getByRole('button', { name: /Remove screen/i }));

    const ask = screen.getByRole('dialog');
    expect(within(ask).getByText(/Removing it would take them with it/)).toBeTruthy();
    fireEvent.click(within(ask).getByRole('radio', { name: /Move them up to/ }));
    fireEvent.click(within(ask).getByRole('button', { name: 'Remove screen' }));

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    expect(saved.screens.find((s) => s.id === 'rides')).toBeUndefined();
    // What it held moved up to where it sat, rather than going with it.
    for (const id of ['rides_current', 'rides_past']) {
      expect(saved.screens.find((s) => s.id === id)!.parent).toBe('root');
    }
  });

  it('lets the author back out, changing nothing', () => {
    renderEditor();
    fireEvent.click(card('Past rides'));
    fireEvent.click(within(inspector('Past rides')).getByRole('radio', { name: /Message/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    // Still a Menu, and nothing to save — the editor's own way of saying the
    // config was never touched.
    expect(within(inspector('Past rides')).getByRole('radio', { name: 'Menu' }).getAttribute('aria-checked')).toBe('true');
    // Nothing to save, and nothing saving: the editor's own way of saying the
    // config was never touched.
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.queryByText('Saving\u2026')).toBeNull();
  });

  it('keeps typed messages in a section, and lets one screen opt out', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Payments'));
    const panel = () => inspector('Payments');

    // Before: one router, so there is no choice to offer — only the switch.
    expect(within(panel()).queryByRole('radio', { name: /Any screen/ })).toBeNull();
    fireEvent.click(within(panel()).getByRole('switch', { name: /Keep typed messages in this section/ }));

    // The section now routes to its own, and says so on the card.
    expect(within(panel()).getByRole('radio', { name: /Payments and below/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(card('Payments')).getByText('Typing stays here')).toBeTruthy();

    // A screen inside it can still be sent back to the whole flow.
    fireEvent.click(card('Charges'));
    fireEvent.click(within(inspector('Charges')).getByRole('radio', { name: /Any screen/ }));

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const scoped = saved.screens.find((s) => s.router && scopeOf(saved, s)?.id === 'payments')!;
    const typedFrom = (id: string) => {
      const free = saved.screens.find((s) => s.id === id)!.prompts[0]!.freeText;
      return free?.kind === 'screen' ? free.screen : undefined;
    };
    expect(typedFrom('payments')).toBe(scoped.id);
    expect(typedFrom('payments_charges')).toBe(saved.screens.find((s) => s.router && !scopeOf(saved, s))!.id);
    expect(scoped.router!.candidates).not.toContain('rides');
  });

  it('gives a Finish a last word, and lets typing end there', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('End of chat'));
    const panel = () => inspector('End of chat');

    const bye = within(panel()).getByLabelText('What the assistant says as it closes');
    fireEvent.change(bye, { target: { value: 'Glad that helped — closing this here.' } });
    fireEvent.blur(bye);

    // Empty, typing can never end the conversation; writing it is the opt-in.
    expect(within(panel()).getByText(/typing can never end the conversation here/)).toBeTruthy();
    const when = within(panel()).getByLabelText('Found by the router');
    fireEvent.change(when, { target: { value: 'they say they are done' } });
    fireEvent.blur(when);

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const end = saved.screens.find((s) => s.id === 'done')!;
    expect(end.endMessage).toBe('Glad that helped — closing this here.');
    expect(end.about).toBe('they say they are done');
    expect(saved.screens.find((s) => s.kind === 'router')!.router!.candidates).toContain('done');
  });

  it('offers screens and lookups from a card, and adds what is picked', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Account' }));

    const menu = screen.getByRole('menu', { name: 'Add to Account' });
    expect(within(menu).getByRole('menuitem', { name: /Message/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Look something up/ })).toBeTruthy();

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Message/ }));
    expect(inspector('New screen')).toBeTruthy();
  });

  it('offers a lookup on a screen that can hold no screens, and only that', () => {
    renderEditor();
    // Nothing goes *inside* a Finish, but something can be fetched before it.
    fireEvent.click(screen.getByRole('button', { name: 'Add to End of chat' }));
    const menu = screen.getByRole('menu', { name: 'Add to End of chat' });
    expect(within(menu).getByRole('menuitem', { name: /Look something up/ })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /Message/ })).toBeNull();
  });

  it('adds a lookup in front of the screen it feeds, and draws it there', () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Account' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Add to Account' })).getByRole('menuitem', { name: /Look something up/ }));

    // A lookup needs somewhere to look before it can exist.
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://api.example.com/account' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Their plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    // Account holds screens, so what it fetches is shared with all of them — the
    // map says so with a box around them, labelled on its border.
    expect(screen.getByRole('button', { name: 'Lookup: Their plan' })).toBeTruthy();
    saveNow();
    return vi.waitFor(() => {
      const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
      expect(saved.screens.find((s) => s.id === 'account')!.calls.map((c) => c.title)).toEqual(['Their plan']);
    });
  });

  it('edits a lookup from its own panel, and says where its answer can be quoted', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Account' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Add to Account' })).getByRole('menuitem', { name: /Look something up/ }));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://api.example.com/account' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    // Selecting the node opens its own panel, not a screen's.
    const panel = screen.getByRole('complementary', { name: /^Lookup: Lookup/ });
    // Account holds screens, so what it fetches is fetched for all of them.
    expect(within(panel).getByText(/On the way into this section/)).toBeTruthy();
    expect(within(panel).getByText('{{steps.lookup.output.body}}')).toBeTruthy();

    // What it fetches, and where someone goes when it cannot be reached.
    fireEvent.change(within(panel).getByLabelText('Method'), { target: { value: 'POST' } });
    fireEvent.change(within(panel).getByLabelText('Open this screen instead'), { target: { value: 'root' } });

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const call = saved.screens.find((s) => s.id === 'account')!.calls[0]!;
    expect(call).toMatchObject({ method: 'POST', url: 'https://api.example.com/account', onFail: 'root', scope: 'section' });
  });

  it('adds a lookup from the panel, then offers its values where you write', async () => {
    const { onSave } = renderEditor();

    // Payments holds screens, so what it fetches is offered "for everything in here".
    fireEvent.click(card('Payments'));
    fireEvent.click(within(inspector('Payments')).getByRole('button', { name: /Look something up/ }));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://api.example.com/balance' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Balance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lookup' }));

    // It is a node on the map, in front of what it feeds.
    expect(screen.getByRole('button', { name: 'Lookup: Balance' })).toBeTruthy();

    // A screen inside the section can put what it found into its own wording.
    fireEvent.click(card('Refunds'));
    const panel = inspector('Refunds');
    fireEvent.click(within(panel).getByRole('button', { name: 'Insert a value…' }));
    fireEvent.click(within(within(panel).getByRole('listbox', { name: 'Insert a value' })).getByRole('option', { name: 'the whole answer' }));

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const refunds = saved.screens.find((s) => s.id === 'payments_refunds')!;
    expect(refunds.prompts[0]!.says[0]).toContain('{{steps.balance.output.body}}');
    expect(saved.screens.find((s) => s.id === 'payments')!.calls.map((c) => c.scope)).toEqual(['section']);
  });

  it('inserts a looked-up value into the message it was opened from', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Payments'));
    fireEvent.click(within(inspector('Payments')).getByRole('button', { name: /Look something up/ }));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://api.example.com/balance' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Balance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lookup' }));

    fireEvent.click(card('Refunds'));
    const panel = () => inspector('Refunds');
    fireEvent.click(within(panel()).getByRole('button', { name: '+ Message' }));

    // Each box has its own picker; the one opened is the one written into.
    const pickers = within(panel()).getAllByRole('button', { name: 'Insert a value\u2026' });
    expect(pickers).toHaveLength(2);
    fireEvent.click(pickers[1]!);
    fireEvent.click(
      within(within(panel()).getByRole('listbox', { name: 'Insert a value' })).getByRole('option', { name: 'the whole answer' }),
    );

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const says = readConversationalFlow(onSave.mock.calls.at(-1)![0])!
      .screens.find((s) => s.id === 'payments_refunds')!.prompts[0]!.says;

    expect(says).toHaveLength(2);
    expect(says[1]).toContain('{{steps.balance.output.body}}');
    // And the first message is left exactly as it was.
    expect(says[0]).not.toContain('{{steps.balance.output.body}}');
  });

  it('configures the whole request from the panel, and the step accepts it', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Payments'));
    fireEvent.click(within(inspector('Payments')).getByRole('button', { name: /Look something up/ }));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://api.example.com/orders' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Orders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lookup' }));

    const panel = screen.getByRole('complementary', { name: 'Lookup: Orders' });
    // A method that sends something, a header, a credential, and named fields.
    fireEvent.change(within(panel).getByLabelText('Method'), { target: { value: 'POST' } });
    // Each part of the request is a tab, the way Postman and n8n do it.
    fireEvent.click(within(panel).getByRole('tab', { name: /Headers/ }));
    // A header: the blank row at the end is the row you type in.
    const name = within(panel).getByLabelText('Headers name');
    fireEvent.change(name, { target: { value: 'X-Tenant' } });
    fireEvent.blur(name);
    const val = within(panel).getAllByLabelText('Headers value')[0]!;
    fireEvent.change(val, { target: { value: 'acme' } });
    fireEvent.blur(val);

    fireEvent.click(within(panel).getByRole('tab', { name: /Body/ }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Raw' }));
    const body = within(panel).getByLabelText('Body');
    fireEvent.change(body, { target: { value: '{"id":"{{trigger.context.orderId}}"}' } });
    fireEvent.blur(body);

    // The fields come off a pasted response rather than being written by hand.
    fireEvent.click(within(panel).getByRole('tab', { name: /Answer/ }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Paste a sample response' }));
    const sample = within(panel).getByLabelText('A sample response');
    fireEvent.change(sample, { target: { value: '{"status":"shipped","address":{"city":"Bengaluru"}}' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Read the fields' }));

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls.at(-1)![0];
    const call = readConversationalFlow(saved)!.screens.find((s) => s.id === 'payments')!.calls[0]!;

    expect(call).toMatchObject({ method: 'POST', url: 'https://api.example.com/orders' });
    expect(call.fields.map((f) => f.path)).toEqual(['status', 'address.city']);
    expect((call.request as Record<string, unknown>)['headers']).toEqual({ 'X-Tenant': 'acme' });
    // And the engine accepts what the panel wrote.
    expect(new ConfigValidator(new ConnectorRegistry()).validate(saved).issues.filter((i) => i.location?.stepId === call.id)).toEqual([]);
  });

  it('opens a lookup in the same panel a screen opens in', () => {
    renderEditor();
    fireEvent.click(card('Payments'));
    fireEvent.click(within(inspector('Payments')).getByRole('button', { name: /Look something up/ }));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://api.example.com/x' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Orders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lookup' }));

    // The same chrome: a trail you can click, a renameable title, a tag and the
    // id, a close button — and the panel keeps whatever width it was dragged to.
    const panel = screen.getByRole('complementary', { name: 'Lookup: Orders' });
    expect(within(panel).getByLabelText('Lookup name')).toHaveValue('Orders');
    expect(within(panel).getByText('Lookup')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Close' })).toBeTruthy();
    // Its trail walks back up to where it runs.
    fireEvent.click(within(panel).getByRole('button', { name: 'Payments' }));
    expect(inspector('Payments')).toBeTruthy();
  });

  it('shows where the weight of a request is, before you go looking', () => {
    renderEditor();
    fireEvent.click(card('Payments'));
    fireEvent.click(within(inspector('Payments')).getByRole('button', { name: /Look something up/ }));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://api.example.com/x' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Orders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lookup' }));
    const panel = screen.getByRole('complementary', { name: 'Lookup: Orders' });

    // Nothing set: no counts anywhere, and a GET has no Body tab at all.
    expect(within(panel).getByRole('tab', { name: 'Headers' })).toBeTruthy();
    expect(within(panel).queryByRole('tab', { name: /Body/ })).toBeNull();

    fireEvent.click(within(panel).getByRole('tab', { name: /Headers/ }));
    const name = within(panel).getByLabelText('Headers name');
    fireEvent.change(name, { target: { value: 'X-Tenant' } });
    fireEvent.blur(name);

    // The count says so without opening the tab.
    expect(within(panel).getByRole('tab', { name: 'Headers 1' })).toBeTruthy();
  });

  it('declares what the conversation is started with, on its first screen', async () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Support'));
    const panel = inspector('Support');

    // Named by pasting what the app passes in, the way a lookup's fields are.
    fireEvent.click(within(panel).getByRole('button', { name: 'Paste a sample start' }));
    fireEvent.change(within(panel).getByLabelText('A sample start'), {
      target: { value: '{"orderId":"A-1","customer":{"tier":"priority"}}' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Read the names' }));

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls.at(-1)![0];
    expect(readConversationalFlow(saved)!.inputs.map((i) => i.path)).toEqual(['orderId', 'customer.tier']);
    // It is the trigger's own schema, so the validator can hold references to it.
    // (The fixture routes with the host's agent step, which a bare registry
    // doesn't know — those issues are the fixture's, not this edit's.)
    const said = new ConfigValidator(new ConnectorRegistry()).validate(saved).issues;
    expect(said.filter((i) => i.code === 'unknownReference')).toEqual([]);
  });

  it('conditions an option on a value it works out, without a text box', async () => {
    // The screens editor has no text mode, so the only way an author gets an
    // expression is for the form to write one.
    const { onSave } = renderEditor();

    fireEvent.click(card('Support'));
    fireEvent.click(within(inspector('Support')).getByRole('button', { name: 'Paste a sample start' }));
    fireEvent.change(within(inspector('Support')).getByLabelText('A sample start'), {
      target: { value: '{"tier":"priority"}' },
    });
    fireEvent.click(within(inspector('Support')).getByRole('button', { name: 'Read the names' }));

    const panel = () => inspector('Support');
    fireEvent.click(within(panel()).getAllByRole('button', { name: 'Only when…' })[1]!);

    // Pick "work it out" off the same dropdown that lists the known values,
    // rather than knowing the sentinel it uses.
    const which = within(panel()).getByLabelText('Which value');
    const workItOut = within(which).getByRole('option', { name: 'Work it out…' }) as HTMLOptionElement;
    fireEvent.change(which, { target: { value: workItOut.value } });

    fireEvent.change(within(panel()).getByLabelText('What to work out'), { target: { value: '$uppercase' } });
    fireEvent.change(within(panel()).getByLabelText('Which value'), { target: { value: 'trigger.context.tier' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Insert' }));

    // The expression is now shown as one — not dropped into a box labelled
    // `{{steps.…}}` next to a button that replaced it with the first value in
    // the list, which is what used to happen.
    expect(within(panel()).getByText('{% $uppercase(trigger.context.tier) %}')).toBeTruthy();

    // And "rebuild" reopens the form holding it, rather than starting over.
    fireEvent.click(within(panel()).getByRole('button', { name: 'rebuild' }));
    expect(
      (within(panel()).getByLabelText('What to work out') as HTMLSelectElement).value,
    ).toBe('$uppercase');
    expect((within(panel()).getByLabelText('Which value') as HTMLSelectElement).value).toBe(
      'trigger.context.tier',
    );
    fireEvent.click(within(panel()).getByRole('button', { name: 'Insert' }));

    fireEvent.change(within(panel()).getByLabelText('How to compare it'), { target: { value: 'eq' } });
    fireEvent.change(within(panel()).getByLabelText('Compared with'), { target: { value: 'PRIORITY' } });

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const options = saved.screens.find((s) => s.id === saved.rootScreen)!.prompts[0]!.options;

    expect(options[1]!.when).toEqual({
      variable: '{% $uppercase(trigger.context.tier) %}',
      operator: 'eq',
      value: 'PRIORITY',
    });
  });

  it('offers one option only under a condition, and leaves the rest of the screen alone', async () => {
    const { onSave } = renderEditor();

    // Something to decide on: what the conversation is started with.
    fireEvent.click(card('Support'));
    fireEvent.click(within(inspector('Support')).getByRole('button', { name: 'Paste a sample start' }));
    fireEvent.change(within(inspector('Support')).getByLabelText('A sample start'), {
      target: { value: '{"tier":"priority"}' },
    });
    fireEvent.click(within(inspector('Support')).getByRole('button', { name: 'Read the names' }));

    const panel = () => inspector('Support');
    const before = within(panel()).getAllByLabelText(/^Option \d+$/).map((i) => (i as HTMLInputElement).value);

    // A condition on one line of the menu, said in full.
    fireEvent.click(within(panel()).getAllByRole('button', { name: 'Only when…' })[1]!);
    fireEvent.change(within(panel()).getByLabelText('Which value'), { target: { value: '{{trigger.context.tier}}' } });
    fireEvent.change(within(panel()).getByLabelText('How to compare it'), { target: { value: 'neq' } });
    fireEvent.change(within(panel()).getByLabelText('Compared with'), { target: { value: 'priority' } });

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const options = saved.screens.find((s) => s.id === saved.rootScreen)!.prompts[0]!.options;

    // Every option still there, leading where it did — one of them conditional.
    expect(options.map((o) => o.label)).toEqual(before);
    expect(options.filter((o) => o.when)).toHaveLength(1);
    expect(options[1]!.when).toEqual({ variable: '{{trigger.context.tier}}', operator: 'neq', value: 'priority' });
  });

  it('lets each way of asking say its own things', async () => {
    const { onSave } = renderEditor();
    // A version needs something to condition on, so the flow needs a start.
    fireEvent.click(card('Support'));
    fireEvent.click(within(inspector('Support')).getByRole('button', { name: 'Paste a sample start' }));
    fireEvent.change(within(inspector('Support')).getByLabelText('A sample start'), {
      target: { value: '{"tier":"priority"}' },
    });
    fireEvent.click(within(inspector('Support')).getByRole('button', { name: 'Read the names' }));

    fireEvent.click(card('Refunds'));
    const panel = () => inspector('Refunds');

    // Two ways of asking: one under a condition, one for when it doesn't hold.
    fireEvent.click(within(panel()).getByRole('button', { name: /Ask differently when/ }));

    // Each version has its own boxes, named apart so neither is ambiguous.
    const conditional = within(panel()).getByLabelText('What it says when 1');
    expect(within(panel()).getByLabelText('What it says otherwise')).toBeTruthy();

    // A second message on the conditional version only.
    write(conditional, 'You\u2019re on our priority plan.');
    const sections = within(panel()).getAllByRole('button', { name: '+ Message' });
    fireEvent.click(sections[0]!);
    const second = within(panel()).getByLabelText('What it says when 1 \u2014 message 2 of 2');
    write(second, 'I\u2019ll get someone to you right away.');

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const refunds = saved.screens.find((s) => s.id === 'payments_refunds')!;

    expect(refunds.prompts).toHaveLength(2);
    // The conditional one says two things; the other is untouched and says one.
    expect(refunds.prompts[0]!.says).toEqual(['You\u2019re on our priority plan.', 'I\u2019ll get someone to you right away.']);
    expect(refunds.prompts[1]!.says).toHaveLength(1);
  });

  it('asks a screen differently depending on a value, and says so in the config', async () => {
    const { onSave } = renderEditor();

    // Something to decide on: what the conversation is started with.
    fireEvent.click(card('Support'));
    fireEvent.click(within(inspector('Support')).getByRole('button', { name: 'Paste a sample start' }));
    fireEvent.change(within(inspector('Support')).getByLabelText('A sample start'), {
      target: { value: '{"tier":"priority"}' },
    });
    fireEvent.click(within(inspector('Support')).getByRole('button', { name: 'Read the names' }));

    // A second way of asking one screen.
    fireEvent.click(card('Refunds'));
    const panel = () => inspector('Refunds');
    // One click adds a second way of asking; it starts on whatever this screen
    // knows first, and the condition is then said in full.
    fireEvent.click(within(panel()).getByRole('button', { name: /Ask differently when/ }));
    fireEvent.click(within(panel()).getByRole('button', { name: /Asked when/ }));
    fireEvent.change(within(panel()).getByLabelText('Which value'), { target: { value: '{{trigger.context.tier}}' } });

    // It reads as a sentence, and the value it compares against is editable.
    expect(within(panel()).getByLabelText('How to compare it')).toHaveValue('eq');
    fireEvent.change(within(panel()).getByLabelText('Compared with'), { target: { value: 'priority' } });

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const refunds = saved.screens.find((s) => s.id === 'payments_refunds')!;

    // Two ways of asking: one under the condition, one for when it doesn't hold.
    expect(refunds.versions).toHaveLength(2);
    expect(refunds.versions[0]!.when).toEqual({ variable: '{{trigger.context.tier}}', operator: 'eq', value: 'priority' });
    expect(refunds.versions[1]!.when).toBeUndefined();
    // And it is still an ordinary screen — Refunds holds screens, so a menu,
    // in the same place it was, with the same children.
    expect(refunds.kind).toBe('menu');
    expect(refunds.parent).toBe('payments');
    expect(refunds.children.length).toBeGreaterThan(0);
  });

  it('explains an edit it refuses, and changes nothing', () => {
    const { onSave } = renderEditor();
    // The first screen is the conversation, so what is inside it has no outside
    // to be moved to. That one is still refused rather than asked about.
    fireEvent.click(card('Support'));
    fireEvent.click(within(inspector('Support')).getByRole('radio', { name: /Message/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/always a Menu/);
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the router’s list honest when a screen is described', () => {
    const { onSave } = renderEditor();
    fireEvent.click(card('Payments'));
    const about = within(inspector('Payments')).getByLabelText('Found by the router');
    fireEvent.change(about, { target: { value: 'anything about paying' } });
    fireEvent.blur(about);
    saveNow();
    return vi.waitFor(() => {
      const saved = readConversationalFlow(onSave.mock.calls[0]![0])!;
      expect(saved.screens.find((s) => s.kind === 'router')!.router!.task).toContain('payments (Payments) [section] — anything about paying');
    });
  });
});

describe('Build — a screen whose purpose is to ask', () => {
  /** Add one inside Account, from the menu an author uses. */
  const askInside = (what: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name: 'Add to Account' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Add to Account' })).getByRole('menuitem', { name: what }));
  };

  it('is added as its own kind, with one screen inside it', async () => {
    const { onSave } = renderEditor();
    askInside(/Ask for details/);

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const node = saved.screens.find((s) => s.title === 'Ask for details')!;
    expect(node.kind).toBe('input');
    expect(node.children).toHaveLength(1);
    // Nothing of its own to ask twice: it is passed through, not returned to.
    expect(node.prompts).toEqual([]);
    expect(saved.screens.find((s) => s.id === node.children[0])!.prompts[0]!.options.filter((o) => o.back).map((o) => o.value))
      .not.toContain(node.id);
  });

  it('asks for what the author names, and offers it to the screen inside', async () => {
    const { onSave } = renderEditor();
    askInside(/Ask for details/);
    const panel = () => inspector('Ask for details');

    fireEvent.click(within(panel()).getByRole('button', { name: 'Ask for something' }));
    const label = within(panel()).getByLabelText('What to ask for');
    fireEvent.change(label, { target: { value: 'Account number' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add' }));
    fireEvent.click(within(panel()).getByLabelText('They must answer to go further'));

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const node = saved.screens.find((s) => s.title === 'Ask for details')!;
    // The key is the kind, so a client reads the same name in every workflow.
    expect(node.questions[0]!.asks).toEqual([
      { kind: 'text', name: 'textInput', label: 'Account number', required: true, choices: [], multiple: false },
    ]);
    // A way out comes with it, so a question they cannot answer is never a dead end.
    expect(node.questions[0]!.options.map((o) => o.label)).toEqual(['↑ Account', 'Main menu']);

    // And the screen inside is offered the answer by the name it is quoted with.
    fireEvent.click(card(saved.screens.find((s) => s.id === node.children[0])!.title));
    const inside = inspector(saved.screens.find((s) => s.id === node.children[0])!.title);
    fireEvent.click(within(inside).getByRole('button', { name: /Insert a value/ }));
    expect(within(within(inside).getByRole('listbox', { name: 'Insert a value' })).getByText('Ask for details')).toBeTruthy();
  });

  it('answers every question the panel asks of a kind', () => {
    // The rows a panel draws are chosen by what kind a screen is, so a new kind
    // has to answer each one. This is the list; it is why the first cut of this
    // screen was missing half its panel.
    renderEditor();
    askInside(/Ask for details/);
    const panel = inspector('Ask for details');

    // What it is for, and where answering takes them.
    expect(within(panel).getByText('What it asks for')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'What happens next' })).toBeTruthy();
    // The router can open it, so its author can say when.
    expect(within(panel).getByLabelText('Found by the router')).toBeTruthy();
    // It offers ways out, so the switch that writes them is there.
    expect(within(panel).getByText('Offer the way back')).toBeTruthy();
    // And it is added rather than converted, so no type to choose.
    expect(within(panel).queryByText('Screen type')).toBeNull();
  });

  it('holds the one screen that answering opens, and offers no button to go on', async () => {
    const { onSave } = renderEditor();
    askInside(/Ask for details/);

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const node = saved.screens.find((s) => s.title === 'Ask for details')!;
    expect(node.children).toHaveLength(1);
    // Everything it offers is a way out: answering is how they go on.
    expect(node.questions[0]!.options.every((o) => o.back)).toBe(true);
  });

  it('asks one way, and says where asking differently belongs', () => {
    renderEditor();
    askInside(/Ask for details/);
    const panel = inspector('Ask for details');
    // Two ways would be two WAITs with two ids, and the screen inside can only
    // name one — so the answer it opened with would be empty half the time.
    // Both spellings, because the control has two: a button when there is a
    // value to decide on, and a line saying so when there is not. Asserting
    // only the button would pass on a screen that simply has no value yet —
    // which is every input screen, since a question cannot be conditioned on
    // the answer it is about to collect. Together they say it is not offered.
    expect(within(panel).queryByRole('button', { name: /Ask differently when/ })).toBeNull();
    expect(within(panel).queryByText(/To ask differently/)).toBeNull();
  });

  it('asks how it went, with a rating and a way to close', async () => {
    const { onSave } = renderEditor();
    askInside(/Ask how it went/);

    saveNow();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = readConversationalFlow(onSave.mock.calls.at(-1)![0])!;
    const node = saved.screens.find((s) => s.title === 'How did we do?')!;
    expect(node.kind).toBe('input');
    // Named from its label, like every other answer, and labelled for whoever
    // reads the runs so this is the same thing in every workflow.
    expect(node.questions[0]!.asks).toEqual([
      { kind: 'choice', name: 'selectedOptions', label: 'How did we do?', required: false, choices: ['1', '2', '3', '4', '5'], multiple: false },
    ]);
    expect(node.questions[0]!.purpose).toBe('feedback');
    expect(saved.screens.find((s) => s.id === node.children[0])!.kind).toBe('end');
  });
});

describe('Test — talking through the Conversation API', () => {
  const turn = (over: Partial<Turn>): Turn => ({ conversationId: 'conv-1', turnId: null, status: 'working', messages: [], events: [], ...over });
  const first = turn({
    turnId: 'support:body#0/route:case_0#0/ask_root',
    status: 'awaiting_reply',
    screen: { id: 'root', title: 'Support', kind: 'menu', path: ['Support'] },
    messages: [{ role: 'assistant', source: 'flow', text: 'Hi! What do you need help with?' }],
    reply: { options: [{ id: 'payments', label: 'Payments', kind: 'next' }], text: { allowed: true, label: 'Or type your question' } },
  });
  const payments = turn({
    turnId: 'support:body#1/route:case_8#0/ask_payments',
    status: 'awaiting_reply',
    screen: { id: 'payments', title: 'Payments', kind: 'menu', path: ['Support', 'Payments'] },
    messages: [{ role: 'assistant', source: 'flow', text: 'Payments — which part?' }],
    reply: { options: [{ id: 'root', label: 'Main menu', kind: 'back' }], text: { allowed: true } },
    events: [{ type: 'tapped', optionId: 'payments', label: 'Payments' }],
  });
  const charged = turn({
    turnId: 'support:body#3/route:case_22#0/ask_payments_double_charge',
    status: 'awaiting_reply',
    screen: { id: 'payments_double_charge', title: 'Charged twice', kind: 'message', path: ['Support', 'Payments', 'Charges', 'Ride charges', 'Charged twice'] },
    messages: [{ role: 'assistant', source: 'flow', text: 'We found a duplicate authorisation.' }],
    reply: { options: [], text: { allowed: true } },
    events: [
      { type: 'typed', text: 'charged twice' },
      { type: 'routed', to: 'payments_double_charge', title: 'Charged twice', reason: 'A duplicate charge.' },
    ],
  });

  /** Events the fake server has for the stream, handed out as they are pushed. */
  function channel() {
    const queue: ConversationStreamEvent[] = [];
    let wake: (() => void) | undefined;
    return {
      push: (...events: ConversationStreamEvent[]) => {
        queue.push(...events);
        wake?.();
      },
      async *read(signal?: AbortSignal): AsyncGenerator<ConversationStreamEvent> {
        while (!signal?.aborted) {
          while (queue.length) yield queue.shift()!;
          await new Promise<void>((resolve) => (wake = resolve));
        }
      },
    };
  }

  function client(opts: { streams?: boolean } = {}) {
    const live = channel();
    live.push({ type: 'turn', turn: first });
    const c = {
      baseUrl: '/api/workflows-v2',
      conversations: {
        // One call for every move, and its stream is what happened. The fake
        // server queues what the action causes, then hands back the feed.
        advance: vi.fn((input: { workflowId?: string; choice?: string; text?: string; signal?: AbortSignal }) => {
          if (opts.streams === false) {
            return (async function* (): AsyncGenerator<ConversationStreamEvent> {
              throw new Error('stream unavailable');
            })();
          }
          if (input.choice) live.push({ type: 'turn', turn: payments });
          else if (input.text) live.push({ type: 'working', kind: 'router', step: 'classify', title: 'ask-ai' });
          return live.read(input.signal);
        }),
        get: vi.fn(async () => charged),
        watch: vi.fn(() => live.read()),
        end: vi.fn(async () => turn({ status: 'ended' })),
      },
    };
    return { c: c as unknown as WorkflowClient, live, calls: c.conversations };
  }

  const startTest = async (c: WorkflowClient) => {
    withClient(c, <ConversationalFlowTest workflowId="wf-1" config={config} />);
    fireEvent.click(screen.getByRole('button', { name: /Start a test conversation/ }));
    const chat = screen.getByRole('region', { name: 'Test conversation' });
    await within(chat).findByText('Hi! What do you need help with?');
    return chat;
  };

  it('follows the conversation’s stream, answers each turn by its turnId without waiting, and says what happened', async () => {
    const { c, calls } = client();
    const chat = await startTest(c);
    expect(calls.advance).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf-1', stream: true, signal: expect.any(AbortSignal) }));

    await act(async () => {
      fireEvent.click(within(chat).getByRole('button', { name: 'Payments' }));
    });
    expect(calls.advance).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', turnId: first.turnId, choice: 'payments', stream: true }),
    );
    await within(chat).findByText('Payments — which part?');
    expect(within(screen.getByRole('list', { name: 'Screens reached' })).getByText('Tapped “Payments”')).toBeTruthy();
  });

  it('shows what is working while it waits, types out what an agent writes, then the router’s choice and why', async () => {
    const { c, live } = client();
    const chat = await startTest(c);

    fireEvent.change(within(chat).getByLabelText('Reply as them'), { target: { value: 'charged twice' } });
    await act(async () => {
      fireEvent.click(within(chat).getByRole('button', { name: 'Send' }));
    });
    expect(await within(chat).findByText('ask-ai is deciding…')).toBeTruthy();

    await act(async () => {
      live.push({ type: 'text', delta: 'Let me check ' }, { type: 'text', delta: 'your charges.' });
    });
    expect(await within(chat).findByText('Let me check your charges.')).toBeTruthy();

    await act(async () => {
      live.push({ type: 'turn', turn: charged });
    });
    await within(chat).findByText('We found a duplicate authorisation.');
    expect(within(chat).queryByText('Let me check your charges.')).toBeNull();
    const trace = screen.getByRole('list', { name: 'Screens reached' });
    expect(within(trace).getByText('Route typed text chose Charged twice')).toBeTruthy();
    expect(within(trace).getByText('“A duplicate charge.”')).toBeTruthy();
  });

  it('on a hand off, answers as the person who had it, and the flow carries on', async () => {
    const { c, live, calls } = client();
    const chat = await startTest(c);
    const handed = turn({
      turnId: 'support:body#1/route:case_30#0/handoff_talk_to_a_person',
      status: 'handed_off',
      screen: { id: 'talk_to_a_person', title: 'Talk to a person', kind: 'handoff', path: ['Talk to a person'] },
      handoff: { context: [] },
      reply: { options: [{ id: 'done', label: 'End of chat', kind: 'finish' }, { id: 'payments', label: 'Payments', kind: 'next' }], text: { allowed: false } },
    });
    await act(async () => {
      live.push({ type: 'turn', turn: handed });
    });
    await within(chat).findByText('Handed off to a person');
    expect((within(chat).getByLabelText('Reply as them') as HTMLInputElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(within(chat).getByRole('button', { name: 'Payments' }));
    });
    expect(calls.advance).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', turnId: handed.turnId, choice: 'payments', stream: true }),
    );
    expect(within(chat).getByText('The person handed it back: Payments')).toBeTruthy();
    await within(chat).findByText('Payments — which part?');
  });

  it('draws the same conversation as another channel', async () => {
    const { c } = client();
    const chat = await startTest(c);
    // Web widget by default.
    expect(within(chat).getByText('Online')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'WhatsApp' }));
    expect(within(chat).getByText('online')).toBeTruthy();
    expect(within(chat).getByText('Hi! What do you need help with?')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'WhatsApp' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Web' }).getAttribute('aria-checked')).toBe('false');
  });

  /** A screen that asks: a box to type in, a pick, and a way out. */
  const askedTurn = turn({
    turnId: 'support:body#1/route:case_9#0/ask_tell_us_entry',
    status: 'awaiting_reply',
    screen: { id: 'tell_us', title: 'Tell us more', kind: 'input', path: ['Support', 'Tell us more'] },
    messages: [{ role: 'assistant', source: 'flow', text: 'Tell us what happened.' }],
    reply: {
      options: [{ id: 'root', label: 'Main menu', kind: 'back' }],
      text: { allowed: true, label: 'Order number', fills: 'textInput' },
      fields: [
        { name: 'textInput', type: 'text', label: 'Order number', required: false },
        { name: 'selectedOptions', type: 'select', label: 'What went wrong?', required: false,
          options: [{ label: 'Late', value: 'late' }, { label: 'Rude', value: 'rude' }] },
      ],
    },
  });

  it('sends what a screen asked for without a word typed, because the question goes whole', async () => {
    const { c, live, calls } = client();
    const chat = await startTest(c);
    await act(async () => { live.push({ type: 'turn', turn: askedTurn }); });
    await within(chat).findByText('Tell us what happened.');

    // The box they type in is not drawn twice: it is the composer, and it says
    // what the question asked for rather than the word for any old reply.
    expect(within(chat).queryByLabelText('Order number')).toBeNull();
    expect(within(chat).getByPlaceholderText('Order number')).toBeTruthy();

    // A pick is an answer on its own. Asking for a word before it will go is
    // how the one thing the screen asked for becomes unsendable.
    fireEvent.click(within(chat).getByRole('button', { name: 'Late' }));
    fireEvent.click(within(chat).getByRole('button', { name: 'Send' }));
    expect(calls.advance).toHaveBeenLastCalledWith(expect.objectContaining({
      values: { selectedOptions: 'late' },
    }));
  });

  it('takes the pick back, and will not send an answer nobody gave', async () => {
    const { c, live, calls } = client();
    const chat = await startTest(c);
    await act(async () => { live.push({ type: 'turn', turn: askedTurn }); });
    await within(chat).findByText('Tell us what happened.');
    const before = calls.advance.mock.calls.length;

    // Tapping the chip again unpicks it, which leaves nothing given — not an
    // empty answer to send on.
    fireEvent.click(within(chat).getByRole('button', { name: 'Late' }));
    fireEvent.click(within(chat).getByRole('button', { name: 'Late' }));
    fireEvent.click(within(chat).getByRole('button', { name: 'Send' }));
    expect(calls.advance.mock.calls.length).toBe(before);
  });

  it('draws what a screen asks for on WhatsApp too', async () => {
    const { c, live } = client();
    const chat = await startTest(c);
    fireEvent.click(screen.getByRole('radio', { name: 'WhatsApp' }));
    await act(async () => { live.push({ type: 'turn', turn: askedTurn }); });
    await within(chat).findByText('Tell us what happened.');
    expect(within(chat).getByRole('button', { name: 'Late' })).toBeTruthy();
    expect(within(chat).getByText('What went wrong?')).toBeTruthy();
  });

  it('shows more than three options as a WhatsApp list message', async () => {
    const { c, live, calls } = client();
    const chat = await startTest(c);
    fireEvent.click(screen.getByRole('radio', { name: 'WhatsApp' }));
    const many = turn({
      turnId: 'support:body#1/route:case_8#0/ask_payments',
      status: 'awaiting_reply',
      messages: [{ role: 'assistant', source: 'flow', text: 'Payments — which part?' }],
      reply: {
        options: [
          { id: 'refunds', label: 'Refunds', kind: 'next' },
          { id: 'cards', label: 'Cards', kind: 'next' },
          { id: 'charges', label: 'Charges', kind: 'next' },
          { id: 'root', label: 'Main menu', kind: 'back' },
        ],
        text: { allowed: true },
      },
    });
    await act(async () => {
      live.push({ type: 'turn', turn: many });
    });

    const open = await within(chat).findByRole('button', { name: /Choose an option/ });
    expect(within(chat).queryByRole('button', { name: 'Refunds' })).toBeNull();
    fireEvent.click(open);
    await act(async () => {
      fireEvent.click(within(chat).getByRole('button', { name: 'Refunds' }));
    });
    expect(calls.advance).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', turnId: many.turnId, choice: 'refunds', stream: true }),
    );
  });

  it('says so when the conversation can’t be opened, instead of looking idle', async () => {
    const { c } = client({ streams: false });
    withClient(c, <ConversationalFlowTest workflowId="wf-1" config={config} />);
    fireEvent.click(screen.getByRole('button', { name: /Start a test conversation/ }));
    // The stream is the call, so there is nothing to fall back to — and an
    // integrator who sees nothing happen learns nothing.
    expect(await screen.findByText(/stream unavailable/)).toBeTruthy();
  });

  it('shows every call, the stream and its events, and how to make them, in the API tab', async () => {
    const { c } = client();
    await startTest(c);

    fireEvent.click(screen.getByRole('tab', { name: /API/ }));
    const calls = screen.getByRole('region', { name: 'Calls' });
    // One call per move, and its response is the events it sent.
    expect(within(calls).getAllByText('/conversations').length).toBeGreaterThan(0);
    expect(within(calls).getByText('200')).toBeTruthy();
    expect(screen.getByText(new RegExp(`curl -N -X POST '${window.location.origin}/api/workflows-v2/conversations'`))).toBeTruthy();
    // Reconnecting is the read, streamed — not a path of its own.
    expect(screen.getByText(/curl -N '.*\/conversations\/conv-1\?stream=1'/)).toBeTruthy();
  });
});
