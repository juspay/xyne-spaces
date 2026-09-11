import { useState, type ReactElement } from 'react';
import { CopyCopied, CopyDefault } from '@xyne/icons';

/** Copies `value` and confirms with a tick for two seconds. */
export function CopyButton({
  value,
  label,
  trackName,
}: {
  value: string;
  label: string;
  trackName: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type='button'
      onClick={() => void copy()}
      aria-label={label}
      title={label}
      data-track-category='Claw Agents'
      data-track-name={trackName}
      className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
    >
      {copied ? (
        <CopyCopied className='size-4' aria-hidden />
      ) : (
        <CopyDefault className='size-4' aria-hidden />
      )}
    </button>
  );
}
