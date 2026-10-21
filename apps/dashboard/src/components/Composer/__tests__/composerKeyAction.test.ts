import { describe, expect, it } from 'vitest';
import { composerKeyAction, type ComposerKeyState } from '../Composer.utils';

const base: ComposerKeyState = {
  key: 'ArrowUp',
  menuOpen: false,
  isEmpty: true,
  lastUserMessage: 'what changed in the release?',
  modified: false,
  isComposing: false,
};

describe('composerKeyAction', () => {
  it('recalls the last message on ArrowUp in an empty composer', () => {
    expect(composerKeyAction(base)).toBe('recall-last');
  });

  it('leaves ArrowUp to the caret when the composer has text', () => {
    expect(composerKeyAction({ ...base, isEmpty: false })).toBeNull();
  });

  it('does nothing on ArrowUp when nothing was sent yet', () => {
    expect(composerKeyAction({ ...base, lastUserMessage: undefined })).toBeNull();
    expect(composerKeyAction({ ...base, lastUserMessage: '   ' })).toBeNull();
  });

  it('leaves ArrowUp to an open menu', () => {
    expect(composerKeyAction({ ...base, menuOpen: true })).toBeNull();
  });

  it('clears the composer on Escape when it has text', () => {
    expect(composerKeyAction({ ...base, key: 'Escape', isEmpty: false })).toBe('clear');
  });

  it('does nothing on Escape in an empty composer', () => {
    expect(composerKeyAction({ ...base, key: 'Escape', isEmpty: true })).toBeNull();
  });

  it('leaves Escape to an open menu so it only closes the menu', () => {
    expect(
      composerKeyAction({ ...base, key: 'Escape', isEmpty: false, menuOpen: true }),
    ).toBeNull();
  });

  it('ignores modified keys and IME composition', () => {
    expect(composerKeyAction({ ...base, modified: true })).toBeNull();
    expect(composerKeyAction({ ...base, isComposing: true })).toBeNull();
    expect(
      composerKeyAction({ ...base, key: 'Escape', isEmpty: false, isComposing: true }),
    ).toBeNull();
  });

  it('ignores other keys', () => {
    expect(composerKeyAction({ ...base, key: 'ArrowDown' })).toBeNull();
  });
});
