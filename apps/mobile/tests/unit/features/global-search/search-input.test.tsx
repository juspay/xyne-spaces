/**
 * The search field owns the text being typed. These tests pin what the rest of the
 * screen hears about it, and when.
 */
/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import { Platform, TextInput } from 'react-native';

import {
  SearchInput,
  type SearchInputHandle,
} from '@/src/features/global-search/components/search-input';
import type { SearchAction } from '@/src/features/global-search/hooks/use-search-state';
import type { SearchFilterChip, SearchScope } from '@/src/features/global-search/types';

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_target, prop: string) => stub(prop) });
});

jest.mock('uniwind', () => ({
  useCSSVariable: () => '#ffffff',
  useUniwind: () => ({ theme: 'light' }),
}));

jest.mock('@/src/utils/haptics', () => ({ haptics: { buttonTap: jest.fn() } }));

jest.mock('@/src/theme/useBubbleAccent', () => ({
  useBubbleAccent: () => ({ accentSoft: '#eeeeee', accentText: '#111111' }),
}));

const QUIET_MS = 250;
const CEILING_MS = 700;
const ZERO_WIDTH_SPACE = '​';

const fromAda: SearchFilterChip = { id: 'u1', label: 'Ada', prefix: 'from:', entityType: 'user' };

type Setup = {
  dispatched: SearchAction[];
  onRequestClose: jest.Mock;
  handle: React.RefObject<SearchInputHandle | null>;
  field: () => TextInput['props'] & { value?: string };
  type: (text: string) => void;
};

function setup(options: { chips?: SearchFilterChip[]; scope?: SearchScope | null } = {}): Setup {
  const dispatched: SearchAction[] = [];
  const onRequestClose = jest.fn();
  const handle = createRef<SearchInputHandle>();

  render(
    <SearchInput
      ref={handle}
      tab='messages'
      chips={options.chips ?? []}
      scope={options.scope ?? null}
      dispatch={action => dispatched.push(action)}
      onRequestClose={onRequestClose}
    />,
  );

  const input = (): ReturnType<typeof screen.UNSAFE_getByType> =>
    screen.UNSAFE_getByType(TextInput);

  return {
    dispatched,
    onRequestClose,
    handle,
    field: () => input().props,
    type: text => fireEvent.changeText(input(), text),
  };
}

function wait(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('SearchInput', () => {
  describe('typing', () => {
    it('shows each keystroke without telling the screen', () => {
      const { dispatched, field, type } = setup();

      type('h');
      type('he');
      type('hel');

      expect(field().value).toBe('hel');
      expect(dispatched).toEqual([]);
    });

    it('commits the query once typing pauses', () => {
      const { dispatched, type } = setup();

      type('hello');
      wait(QUIET_MS);

      expect(dispatched).toEqual([{ type: 'queryCommitted', query: 'hello' }]);
    });

    it('commits mid-burst when typing never pauses', () => {
      const { dispatched, type } = setup();

      // A keystroke every 100ms never leaves a 250ms gap, so only the 700ms ceiling
      // can commit — which it does with whatever has been typed by then.
      'continuous'.split('').forEach((_, index, letters) => {
        type(letters.slice(0, index + 1).join(''));
        wait(100);
      });

      const committed = dispatched.filter(action => action.type === 'queryCommitted');
      expect(committed.length).toBeGreaterThan(0);
      expect(committed[0]).toEqual({ type: 'queryCommitted', query: 'continu' });
    });

    it('searches immediately on submit', () => {
      const { dispatched, field, type } = setup();

      type('hello');
      act(() => field().onSubmitEditing?.({} as never));

      expect(dispatched).toEqual([{ type: 'queryCommitted', query: 'hello' }]);
    });
  });

  describe('from: and in: operators', () => {
    it('reports the trigger as it is typed, without waiting for the debounce', () => {
      const { dispatched, type } = setup();

      type('urgent from:al');

      expect(dispatched).toEqual([
        {
          type: 'triggerChanged',
          trigger: { kind: 'from', query: 'al', startIndex: 7, inMode: 'all' },
        },
      ]);
    });

    it('commits only the text before the operator', () => {
      const { dispatched, type } = setup();

      type('urgent from:al');
      wait(QUIET_MS);

      expect(dispatched.at(-1)).toEqual({ type: 'queryCommitted', query: 'urgent' });
    });

    it('reports the trigger going away', () => {
      const { dispatched, type } = setup();

      type('in:#gen');
      type('');

      expect(dispatched.at(-1)).toEqual({ type: 'triggerChanged', trigger: null });
    });

    it('rewrites the field once a suggestion is picked', () => {
      const { dispatched, field, handle, type } = setup();
      type('urgent from:al');
      dispatched.length = 0;

      act(() => handle.current?.resolveTrigger());

      expect(field().value).toBe('urgent');
      expect(dispatched).toEqual([
        { type: 'triggerChanged', trigger: null },
        { type: 'queryCommitted', query: 'urgent' },
      ]);
    });

    it('does not commit the stale text after a suggestion is picked', () => {
      const { dispatched, handle, type } = setup();
      type('urgent from:al');
      act(() => handle.current?.resolveTrigger());
      dispatched.length = 0;

      wait(CEILING_MS);

      expect(dispatched).toEqual([]);
    });
  });

  describe('clear button', () => {
    it('empties the field and the search', () => {
      const { dispatched, field, type } = setup();
      type('hello');

      fireEvent.press(screen.getByLabelText('Clear search'));

      expect(field().value).toBe('');
      expect(dispatched).toEqual([{ type: 'cleared' }]);
    });

    it('drops the commit that was still pending', () => {
      const { dispatched, type } = setup();
      type('hello');
      fireEvent.press(screen.getByLabelText('Clear search'));
      dispatched.length = 0;

      wait(CEILING_MS);

      expect(dispatched).toEqual([]);
    });

    it('clears chips when there is no text', () => {
      const { dispatched, onRequestClose } = setup({ chips: [fromAda] });

      fireEvent.press(screen.getByLabelText('Clear search'));

      expect(dispatched).toEqual([{ type: 'cleared' }]);
      expect(onRequestClose).not.toHaveBeenCalled();
    });

    it('closes the screen when there is nothing to clear', () => {
      const { dispatched, onRequestClose } = setup();

      fireEvent.press(screen.getByLabelText('Clear search'));

      expect(onRequestClose).toHaveBeenCalledTimes(1);
      expect(dispatched).toEqual([]);
    });
  });

  describe('chips', () => {
    it('shows each chip with its filter name', () => {
      setup({ chips: [fromAda] });

      expect(screen.getByText('From: Ada')).toBeTruthy();
    });

    it('removes a chip from its own button', () => {
      const { dispatched } = setup({ chips: [fromAda] });

      fireEvent.press(screen.getByLabelText('Remove From: Ada'));

      expect(dispatched).toEqual([{ type: 'chipRemoved', chip: fromAda }]);
    });

    it('hides the placeholder while chips are shown', () => {
      const { field } = setup({ chips: [fromAda] });

      expect(field().placeholder).toBe('');
    });
  });

  describe('backspace on an empty field', () => {
    const backspace = { nativeEvent: { key: 'Backspace' } } as never;

    it('removes the last chip on iOS', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      const { dispatched, field } = setup({ chips: [fromAda] });

      act(() => field().onKeyPress?.(backspace));

      expect(dispatched).toEqual([{ type: 'lastChipRemoved' }]);
    });

    it('deletes text first while there is any', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      const { dispatched, field, type } = setup({ chips: [fromAda] });
      type('h');

      act(() => field().onKeyPress?.(backspace));

      expect(dispatched).toEqual([]);
    });

    it('removes the last chip on Android, which sends no key event', () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      const { dispatched, field, type } = setup({ chips: [fromAda] });
      expect(field().value).toBe(ZERO_WIDTH_SPACE);

      // Deleting the sentinel is the only signal Android gives.
      type('');

      expect(dispatched).toEqual([{ type: 'lastChipRemoved' }]);
    });

    it('never lets the Android sentinel reach the query', () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      const { dispatched, type } = setup({ chips: [fromAda] });

      type(`${ZERO_WIDTH_SPACE}h`);
      wait(QUIET_MS);

      expect(dispatched).toEqual([{ type: 'queryCommitted', query: 'h' }]);
    });
  });

  describe('placeholder', () => {
    it('names the tab', () => {
      const { field } = setup();

      expect(field().placeholder).toBe('Search messages');
    });

    it('names the conversation when search is locked to one', () => {
      const { field } = setup({ scope: { channelId: 'c1', label: 'engineering' } });

      expect(field().placeholder).toBe('Search in engineering');
    });
  });
});
