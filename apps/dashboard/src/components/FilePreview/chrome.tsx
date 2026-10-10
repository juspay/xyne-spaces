import { createContext, useContext, useEffect, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/classNames';
import type { FindProvider } from './find';
import type { PreviewSkeleton } from './types';

/**
 * What the frame lends the previewer inside it: two places on its toolbar, the
 * file's download, and its find bar. A previewer puts its own controls on the
 * toolbar through <PreviewControls>, facts about the file beside its type through
 * <PreviewMeta>, and what it can search through usePreviewFind, so every preview has
 * the one toolbar and the one find however different the files are.
 */
interface PreviewFrameContext {
  controls: HTMLElement | null;
  /** The toolbar's far end, after the download: a control that shows or hides a panel. */
  trailing: HTMLElement | null;
  meta: HTMLElement | null;
  download: () => void;
  setFinder: (finder: FindProvider | null) => void;
  /** Opens the find bar: for a view that hears ⌘F where the frame can't, as a page in
   *  a frame of its own. */
  openFind: () => void;
}

export const PreviewFrame = createContext<PreviewFrameContext>({
  controls: null,
  trailing: null,
  meta: null,
  download: () => undefined,
  setFinder: () => undefined,
  openFind: () => undefined,
});

export const usePreviewOpenFind = (): (() => void) => useContext(PreviewFrame).openFind;

/**
 * Lends the frame's find bar what this view can search, for as long as it is on
 * screen; null while there is nothing to search yet. Memoise the provider: a new
 * one searches again.
 */
export function usePreviewFind(finder: FindProvider | null): void {
  const { setFinder } = useContext(PreviewFrame);
  useEffect(() => {
    setFinder(finder);
    return () => setFinder(null);
  }, [finder, setFinder]);
}

/**
 * The previewer's own controls, on the frame's toolbar: a view switch, zoom, wrap —
 * or, `atEnd`, after the find and the download, at the toolbar's far end: where a
 * button showing or hiding a panel goes.
 */
export function PreviewControls(props: {
  children: ReactNode;
  atEnd?: boolean;
}): ReactElement | null {
  const { controls, trailing } = useContext(PreviewFrame);
  const slot = props.atEnd ? trailing : controls;
  return slot ? createPortal(props.children, slot) : null;
}

/** A fact about the file beside its type and size: "1,204 rows", "1920 × 1080". */
export function PreviewMeta(props: { children: ReactNode }): ReactElement | null {
  const { meta } = useContext(PreviewFrame);
  return meta
    ? createPortal(
        <>
          <span aria-hidden='true'>·</span>
          <span className='truncate'>{props.children}</span>
        </>,
        meta,
      )
    : null;
}

export const usePreviewDownload = (): (() => void) => useContext(PreviewFrame).download;

/** A toolbar button: an icon, named by its title. */
export function PreviewButton(props: {
  title: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  trackName: string;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type='button'
      title={props.title}
      aria-label={props.title}
      {...(props.pressed !== undefined && { 'aria-pressed': props.pressed })}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        'outline-none flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40',
        props.pressed
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-foreground/[0.08] focus-visible:bg-foreground/[0.08] hover:text-foreground focus-visible:text-foreground',
      )}
      data-track-category='FilePreview'
      data-track-name={props.trackName}
    >
      {props.children}
    </button>
  );
}

/** Two or three ways to see the same file: Rendered and Source. */
export function PreviewSegmented<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <div
      role='radiogroup'
      aria-label={props.label}
      className='flex h-7 shrink-0 items-center rounded-md bg-muted p-0.5'
    >
      {props.options.map(option => (
        <button
          key={option.value}
          type='button'
          role='radio'
          aria-checked={props.value === option.value}
          onClick={() => props.onChange(option.value)}
          className={cn(
            'outline-none h-6 rounded-[5px] px-2.5 text-xs font-medium transition-colors',
            props.value === option.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground focus-visible:text-foreground',
          )}
          data-track-category='FilePreview'
          data-track-name='PreviewViewChanged'
          data-track-metadata={JSON.stringify({ view: option.value })}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A preview with nothing to draw — none for the type, too large, failed, can't play
 * here — and what can be done instead: always the download, sometimes a retry.
 */
export function PreviewMessage(props: {
  icon?: ReactNode;
  title: string;
  body: string;
  actions: readonly { label: string; onClick: () => void; primary?: boolean; trackName: string }[];
}): ReactElement {
  return (
    <div className='flex h-full min-h-[280px] flex-col items-center justify-center px-6 pb-10 text-center'>
      {props.icon && <div className='mb-4'>{props.icon}</div>}
      <h3 className='text-[15px] font-semibold text-foreground'>{props.title}</h3>
      <p className='mt-1 max-w-[420px] text-[13px] leading-relaxed text-muted-foreground'>
        {props.body}
      </p>
      <div className='mt-5 flex items-center gap-2'>
        {props.actions.map(action => (
          <button
            key={action.label}
            type='button'
            onClick={action.onClick}
            className={cn(
              'outline-none flex h-8 items-center rounded-lg px-3.5 text-[13px] font-medium transition-colors',
              action.primary
                ? 'bg-foreground text-background hover:opacity-90 focus-visible:opacity-90'
                : 'border border-border text-foreground hover:bg-muted focus-visible:bg-muted',
            )}
            data-track-category='FilePreview'
            data-track-name={action.trackName}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const bar = 'rounded bg-muted animate-pulse motion-reduce:animate-none';

/** The pane's shape while the file is on its way, so it never sits blank. */
export function PreviewSkeletonView(props: {
  shape: PreviewSkeleton;
  /** Said under it while the server is still making the preview. */
  note?: string;
}): ReactElement {
  return (
    <div className='relative h-full min-h-0 overflow-hidden' aria-busy='true'>
      {props.shape === 'text' && (
        <div className='space-y-2.5 p-4'>
          {[72, 54, 88, 40, 66, 80, 35, 60, 74, 48].map((width, index) => (
            <div key={index} className='flex items-center gap-4'>
              <div className={cn(bar, 'h-3 w-6 opacity-60')} />
              <div className={cn(bar, 'h-3')} style={{ width: `${width}%` }} />
            </div>
          ))}
        </div>
      )}
      {props.shape === 'document' && (
        <div className='mx-auto max-w-[760px] space-y-3 px-8 py-10'>
          <div className={cn(bar, 'mb-6 h-7 w-2/3')} />
          {[100, 96, 92, 98, 60].map((width, index) => (
            <div key={index} className={cn(bar, 'h-3.5')} style={{ width: `${width}%` }} />
          ))}
          <div className='h-4' />
          {[94, 100, 88, 45].map((width, index) => (
            <div key={index} className={cn(bar, 'h-3.5')} style={{ width: `${width}%` }} />
          ))}
        </div>
      )}
      {props.shape === 'grid' && (
        <div className='grid grid-cols-6 gap-px p-px'>
          {Array.from({ length: 6 * 14 }, (_, index) => (
            <div key={index} className={cn(bar, 'h-7 rounded-none', index < 6 && 'opacity-60')} />
          ))}
        </div>
      )}
      {props.shape === 'media' && (
        <div className='flex h-full items-center justify-center p-8'>
          <div className={cn(bar, 'aspect-video w-full max-w-[720px] rounded-xl')} />
        </div>
      )}
      {props.note && (
        <div className='absolute inset-x-0 bottom-8 flex justify-center'>
          <span className='rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm'>
            {props.note}
          </span>
        </div>
      )}
    </div>
  );
}
