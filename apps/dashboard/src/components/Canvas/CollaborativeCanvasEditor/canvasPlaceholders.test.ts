import { describe, expect, it } from 'vitest';
import { DEFAULT_CANVAS_PLACEHOLDER, resolveCanvasPlaceholders } from './canvasPlaceholders';

const NOTES_HINT = 'Add your notes here, you can view the transcript live in the transcript tab';
const CANVAS_HINT = 'Start writing your canvas...';

describe('resolveCanvasPlaceholders', () => {
  it('uses the generic canvas hint in both slots when neither prop is passed', () => {
    expect(resolveCanvasPlaceholders()).toEqual({
      default: DEFAULT_CANVAS_PLACEHOLDER,
      emptyDocument: DEFAULT_CANVAS_PLACEHOLDER,
    });
  });

  it('puts a lone placeholder in both slots, so existing callers are unchanged', () => {
    // CanvasTab / CanvasScreen / CallNotesPanel / RecordingCanvasPane pass only
    // `placeholder`; they must keep the pre-split behaviour.
    expect(resolveCanvasPlaceholders(CANVAS_HINT)).toEqual({
      default: CANVAS_HINT,
      emptyDocument: CANVAS_HINT,
    });
  });

  it('applies a lone blockPlaceholder to focused empty blocks only', () => {
    expect(resolveCanvasPlaceholders(undefined, CANVAS_HINT)).toEqual({
      default: CANVAS_HINT,
      emptyDocument: DEFAULT_CANVAS_PLACEHOLDER,
    });
  });

  it('keeps the two slots independent, treating an empty blockPlaceholder as "render nothing"', () => {
    // The regression this fix addresses: `''` must NOT fall back to the
    // placeholder, otherwise the notes hint reappears on every new line.
    expect(resolveCanvasPlaceholders(NOTES_HINT, '')).toEqual({
      default: '',
      emptyDocument: NOTES_HINT,
    });
  });

  it('treats an empty placeholder as an explicit empty document hint', () => {
    expect(resolveCanvasPlaceholders('')).toEqual({
      default: '',
      emptyDocument: '',
    });
  });
});
