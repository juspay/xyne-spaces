import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Keyboard, Text, type GestureResponderEvent } from 'react-native';

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardController: { dismiss: jest.fn() },
}));

import { KeyboardController } from 'react-native-keyboard-controller';
import { useTapToDismissKeyboard } from '@/src/hooks/useTapToDismissKeyboard';

type Touch = { pageX: number; pageY: number };

let latest!: ReturnType<typeof useTapToDismissKeyboard>;

function Probe({ enabled }: { enabled: boolean }): ReactElement {
  latest = useTapToDismissKeyboard(enabled);
  return <Text />;
}

const event = ({ pageX, pageY }: Touch): GestureResponderEvent =>
  ({ nativeEvent: { pageX, pageY } }) as GestureResponderEvent;

const mount = (enabled = true): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe enabled={enabled} />);
  });
  return renderer;
};

describe('useTapToDismissKeyboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dismisses both keyboard owners for a tap', () => {
    const keyboardDismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    const renderer = mount();

    act(() => {
      latest.onTouchStart(event({ pageX: 10, pageY: 20 }));
      latest.onTouchEnd();
    });

    expect(keyboardDismiss).toHaveBeenCalledTimes(1);
    expect(KeyboardController.dismiss).toHaveBeenCalledTimes(1);
    keyboardDismiss.mockRestore();
    act(() => renderer.unmount());
  });

  it('keeps the keyboard open after a drag beyond the threshold', () => {
    const keyboardDismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    const renderer = mount();

    act(() => {
      latest.onTouchStart(event({ pageX: 10, pageY: 20 }));
      latest.onTouchMove(event({ pageX: 19, pageY: 20 }));
      latest.onTouchEnd();
    });

    expect(keyboardDismiss).not.toHaveBeenCalled();
    expect(KeyboardController.dismiss).not.toHaveBeenCalled();
    keyboardDismiss.mockRestore();
    act(() => renderer.unmount());
  });

  it('ignores touch events while disabled', () => {
    const keyboardDismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    const renderer = mount(false);

    act(() => {
      latest.onTouchStart(event({ pageX: 10, pageY: 20 }));
      latest.onTouchEnd();
    });

    expect(keyboardDismiss).not.toHaveBeenCalled();
    expect(KeyboardController.dismiss).not.toHaveBeenCalled();
    keyboardDismiss.mockRestore();
    act(() => renderer.unmount());
  });
});
