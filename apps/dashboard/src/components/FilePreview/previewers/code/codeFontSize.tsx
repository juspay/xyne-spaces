import { useSyncExternalStore, type ReactElement } from 'react';
import { AArrowDown, AArrowUp } from 'lucide-react';
import { PreviewButton } from '../../chrome';

const SIZES: readonly number[] = [11, 12, 13, 14, 15, 16, 18, 20];
const DEFAULT_SIZE = 13;
const STORAGE_KEY = 'filePreview.codeFontSize';

// One size for every code view, kept in this browser between visits: a reader who
// needs it larger needs it larger everywhere.
function readSize(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return SIZES.includes(stored) ? stored : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}

let currentSize = readSize();
const listeners = new Set<() => void>();

function setSize(size: number): void {
  currentSize = size;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // Still applies for this visit.
  }
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The code views' text size, in pixels. */
export const useCodeFontSize = (): number =>
  useSyncExternalStore(
    subscribe,
    () => currentSize,
    () => DEFAULT_SIZE,
  );

/** Smaller and larger text, for the toolbar of a view showing code. */
export function CodeFontSizeControls(): ReactElement {
  const size = useCodeFontSize();
  const at = SIZES.indexOf(size);
  const smaller = SIZES[at - 1];
  const larger = SIZES[at + 1];
  return (
    <>
      <PreviewButton
        title='Smaller text'
        onClick={() => smaller !== undefined && setSize(smaller)}
        disabled={smaller === undefined}
        trackName='PreviewCodeTextSmaller'
      >
        <AArrowDown className='size-4' />
      </PreviewButton>
      <PreviewButton
        title='Larger text'
        onClick={() => larger !== undefined && setSize(larger)}
        disabled={larger === undefined}
        trackName='PreviewCodeTextLarger'
      >
        <AArrowUp className='size-4' />
      </PreviewButton>
    </>
  );
}
