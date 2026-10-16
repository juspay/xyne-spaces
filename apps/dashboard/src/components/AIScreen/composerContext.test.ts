import { describe, expect, it, vi } from 'vitest';

// The picker module pulls in browser-only config; these tests only need the
// pure helper, so stub it out (node test environment, no DOM).
vi.mock('../Chat/XyneAISidebar/components/ContextPickerPanel', () => ({
  toAttachedContext: (): unknown[] => [],
}));

import {
  EMPTY_COMPOSER_CONTEXT,
  turnReplayOverrides,
  type ComposerContext,
} from './composerContext';
import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';

type Turn = Pick<Message, 'attachedContext' | 'runOptions'>;

const turnWithContext: Turn = {
  attachedContext: [
    { type: 'channel', id: 'ch-1', title: 'eng' },
    { type: 'ticket', id: 'tk-1', title: 'XYNE-1' },
    { type: 'canvas', id: 'cv-1', title: 'Spec' },
    { type: 'call', id: 'call-1', title: 'Standup' },
    { type: 'file', id: 'file-1', title: 'notes.pdf' },
    { type: 'user', id: 'u-1', title: 'Ann' },
    { type: 'activity', id: 'activity-0', title: 'viewed' },
  ],
};

const composer: ComposerContext = {
  ...EMPTY_COMPOSER_CONTEXT,
  model: 'gpt-5',
  modelProvider: 'litellm',
  thinkingLevel: 'high',
  webSearchEnabled: true,
};

describe('turnReplayOverrides', () => {
  it("rebuilds the turn's own context and id lists (XYNE-66350)", () => {
    const ov = turnReplayOverrides(turnWithContext, null);
    expect(ov.channelIds).toEqual(['ch-1']);
    expect(ov.ticketIds).toEqual(['tk-1']);
    expect(ov.canvasIds).toEqual(['cv-1']);
    expect(ov.callIds).toEqual(['call-1']);
    // Activities are re-added by the hook itself — never doubled.
    expect(ov.attachedContext?.map(i => i.id)).toEqual([
      'ch-1',
      'tk-1',
      'cv-1',
      'call-1',
      'file-1',
      'u-1',
    ]);
    expect(ov.displayAttachedContext).toEqual(ov.attachedContext);
  });

  it("keeps the turn's own model pin and toggles over the composer's (XYNE-66322)", () => {
    const ov = turnReplayOverrides(
      {
        ...turnWithContext,
        runOptions: {
          model: 'claude-sonnet-4-5',
          modelProvider: 'spaces',
          thinkingLevel: 'low',
          webSearchEnabled: false,
          deepResearchEnabled: true,
          createCanvasEnabled: false,
        },
      },
      composer,
    );
    expect(ov.model).toBe('claude-sonnet-4-5');
    expect(ov.modelProvider).toBe('spaces');
    expect(ov.thinkingLevel).toBe('low');
    expect(ov.webSearchEnabled).toBe(false);
    expect(ov.deepResearchEnabled).toBe(true);
  });

  it("falls back to the composer's picks when the turn's run options are unknown (reload)", () => {
    const ov = turnReplayOverrides(turnWithContext, composer);
    expect(ov.model).toBe('gpt-5');
    expect(ov.modelProvider).toBe('litellm');
    expect(ov.thinkingLevel).toBe('high');
    expect(ov.webSearchEnabled).toBe(true);
  });

  it('sends an explicit Auto (model: null) so the hook default cannot leak in', () => {
    const ov = turnReplayOverrides(turnWithContext, null);
    expect('model' in ov).toBe(true);
    expect(ov.model).toBeNull();
    expect(ov.modelProvider).toBeNull();
  });

  it('carries the device harness target for a laptop pin or an Auto run routed to the device', () => {
    const pinned = turnReplayOverrides(
      {
        runOptions: {
          model: 'local-harness:claude-code',
          modelProvider: 'local-harness',
          thinkingLevel: null,
          webSearchEnabled: false,
          deepResearchEnabled: false,
          createCanvasEnabled: false,
        },
      },
      null,
    );
    expect(pinned.localHarnessTarget).toBe('local-harness:claude-code');

    const auto = turnReplayOverrides(
      {},
      { ...EMPTY_COMPOSER_CONTEXT, localHarnessTarget: 'local-harness:codex-cli' },
    );
    expect(auto.localHarnessTarget).toBe('local-harness:codex-cli');

    const serverPin = turnReplayOverrides(
      {},
      { ...composer, localHarnessTarget: 'local-harness:codex-cli' },
    );
    expect(serverPin.localHarnessTarget).toBeUndefined();
  });
});
