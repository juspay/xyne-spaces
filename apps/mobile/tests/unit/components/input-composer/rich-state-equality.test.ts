import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OnChangeStateEvent } from 'react-native-enriched';

import {
  isSameSelection,
  isSameStyleState,
} from '@/src/components/input-composer/utils/rich-state-equality';

const flags = (
  isActive = false,
): { isActive: boolean; isConflicting: boolean; isBlocking: boolean } => ({
  isActive,
  isConflicting: false,
  isBlocking: false,
});

const styleState = (boldActive = false, alignment = 'left'): OnChangeStateEvent => ({
  bold: flags(boldActive),
  italic: flags(),
  underline: flags(),
  strikeThrough: flags(),
  inlineCode: flags(),
  h1: flags(),
  h2: flags(),
  h3: flags(),
  h4: flags(),
  h5: flags(),
  h6: flags(),
  codeBlock: flags(),
  blockQuote: flags(),
  orderedList: flags(),
  unorderedList: flags(),
  link: flags(),
  image: flags(),
  mention: flags(),
  checkboxList: flags(),
  alignment,
});

describe('isSameSelection', () => {
  it('matches equal carets and selected text', () => {
    assert.ok(isSameSelection({ start: 2, end: 4, text: 'hi' }, { start: 2, end: 4, text: 'hi' }));
    assert.ok(isSameSelection(null, null));
  });
  it('differs on any field or null', () => {
    assert.ok(!isSameSelection({ start: 2, end: 4, text: 'hi' }, { start: 3, end: 4, text: 'hi' }));
    assert.ok(!isSameSelection({ start: 2, end: 4, text: 'hi' }, { start: 2, end: 4, text: 'ho' }));
    assert.ok(!isSameSelection({ start: 0, end: 0, text: '' }, null));
  });
});

describe('isSameStyleState', () => {
  it('matches a fresh event with the same flags', () => {
    assert.ok(isSameStyleState(styleState(), styleState()));
    assert.ok(isSameStyleState(null, null));
  });
  it('differs when any flag changes', () => {
    assert.ok(!isSameStyleState(styleState(), styleState(true)));
    assert.ok(!isSameStyleState(styleState(), styleState(false, 'center')));
    const conflicting = styleState();
    conflicting.italic = { ...flags(), isConflicting: true };
    assert.ok(!isSameStyleState(styleState(), conflicting));
    const blocking = styleState();
    blocking.link = { ...flags(), isBlocking: true };
    assert.ok(!isSameStyleState(styleState(), blocking));
    assert.ok(!isSameStyleState(styleState(), null));
  });
});
