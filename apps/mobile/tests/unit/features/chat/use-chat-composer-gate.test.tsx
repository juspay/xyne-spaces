import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { useBoundedComposerGate } from '@/src/features/chat/v2/hooks/use-chat-composer-gate';

type ProbeProps = { blocked: boolean; identityKey: string };

let lastGateValue = false;

function Probe({ blocked, identityKey }: ProbeProps): ReactElement {
  lastGateValue = useBoundedComposerGate(blocked, identityKey);
  return <Text>{String(lastGateValue)}</Text>;
}

const renderProbe = (props: ProbeProps): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe {...props} />);
  });
  return renderer;
};

const update = (renderer: ReactTestRenderer, props: ProbeProps): void => {
  act(() => {
    renderer.update(<Probe {...props} />);
  });
};

const advance = (ms: number): void => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

describe('useBoundedComposerGate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    lastGateValue = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('expires after the bounded wait when blocked continuously', () => {
    renderProbe({ blocked: true, identityKey: 'a' });
    expect(lastGateValue).toBe(true);

    advance(5_999);
    expect(lastGateValue).toBe(true);

    advance(1);
    expect(lastGateValue).toBe(false);
  });

  it('does not block once the surface reports ready', () => {
    const renderer = renderProbe({ blocked: true, identityKey: 'a' });
    update(renderer, { blocked: false, identityKey: 'a' });
    expect(lastGateValue).toBe(false);
  });

  it('gives a new open identity its own full grace period', () => {
    const renderer = renderProbe({ blocked: true, identityKey: 'a' });
    advance(6_000);
    expect(lastGateValue).toBe(false);

    update(renderer, { blocked: true, identityKey: 'b' });
    expect(lastGateValue).toBe(true);

    advance(5_999);
    expect(lastGateValue).toBe(true);

    advance(1);
    expect(lastGateValue).toBe(false);
  });

  it('stays interactive within the bounded wait even when blocked oscillates', () => {
    const renderer = renderProbe({ blocked: true, identityKey: 'a' });

    // A slow chat open toggles its readiness inputs while cache and live
    // windows reconcile. Each toggle must not restart the bounded wait.
    for (let i = 0; i < 10; i++) {
      advance(5_000);
      update(renderer, { blocked: false, identityKey: 'a' });
      update(renderer, { blocked: true, identityKey: 'a' });
    }

    // 50s of wall clock have passed for this identity.
    expect(lastGateValue).toBe(false);
  });
});
