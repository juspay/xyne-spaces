// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createVoiceLevelStore } from '../audio/levelStore';
import { VoiceStage } from './VoiceStage';

const mountedStages: Array<() => void> = [];
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let previousActEnvironment: boolean | undefined;

function mountVoiceStage(): {
  orb: HTMLButtonElement;
  onPress: ReturnType<typeof vi.fn>;
  onRelease: ReturnType<typeof vi.fn>;
  onInterrupt: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onPress = vi.fn();
  const onRelease = vi.fn();
  const onInterrupt = vi.fn();

  act(() => {
    root.render(
      createElement(VoiceStage, {
        phase: 'idle',
        content: { prompt: null, chips: [], caption: null, steps: [] },
        levelStore: createVoiceLevelStore(),
        speaksReplies: false,
        onPress,
        onRelease,
        onInterrupt,
        onChip: vi.fn(),
        onShowText: vi.fn(),
        onSpeaksRepliesChange: vi.fn(),
        onEnd: vi.fn(),
        trace: null,
      }),
    );
  });

  const orb = container.querySelector<HTMLButtonElement>('[data-voice-orb]');
  if (!orb) throw new Error('Voice orb was not rendered.');

  const unmount = (): void => {
    act(() => root.unmount());
    container.remove();
  };
  mountedStages.push(unmount);

  return {
    orb,
    onPress,
    onRelease,
    onInterrupt,
    unmount,
  };
}

function pointerEvent(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    pointerId: { value: 1 },
  });
  return event;
}

describe('voice stage capture controls', () => {
  beforeAll(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    if (previousActEnvironment === undefined) delete reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
    else reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  afterEach(() => {
    mountedStages.splice(0).forEach(unmount => unmount());
    vi.useRealTimers();
  });

  it('submits on pointer release and discards on pointer cancellation', () => {
    const stage = mountVoiceStage();
    Object.defineProperty(stage.orb, 'setPointerCapture', { value: vi.fn() });

    act(() => {
      stage.orb.dispatchEvent(pointerEvent('pointerdown'));
    });
    act(() => {
      stage.orb.dispatchEvent(pointerEvent('pointerup'));
    });
    expect(stage.onPress).toHaveBeenCalledTimes(1);
    expect(stage.onRelease).toHaveBeenCalledTimes(1);
    expect(stage.onInterrupt).not.toHaveBeenCalled();

    act(() => {
      stage.orb.dispatchEvent(pointerEvent('pointerdown'));
    });
    act(() => {
      stage.orb.dispatchEvent(pointerEvent('pointercancel'));
    });
    expect(stage.onPress).toHaveBeenCalledTimes(2);
    expect(stage.onRelease).toHaveBeenCalledTimes(1);
    expect(stage.onInterrupt).toHaveBeenCalledTimes(1);
  });

  it('submits on deliberate Space release', () => {
    vi.useFakeTimers();
    const stage = mountVoiceStage();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', cancelable: true }));
      vi.advanceTimersByTime(200);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', cancelable: true }));
    });

    expect(stage.onPress).toHaveBeenCalledTimes(1);
    expect(stage.onRelease).toHaveBeenCalledTimes(1);
    expect(stage.onInterrupt).not.toHaveBeenCalled();
  });

  it('discards when the window loses focus during a Space hold', () => {
    vi.useFakeTimers();
    const stage = mountVoiceStage();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', cancelable: true }));
      vi.advanceTimersByTime(200);
    });
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(stage.onPress).toHaveBeenCalledTimes(1);
    expect(stage.onRelease).not.toHaveBeenCalled();
    expect(stage.onInterrupt).toHaveBeenCalledTimes(1);
  });
});
