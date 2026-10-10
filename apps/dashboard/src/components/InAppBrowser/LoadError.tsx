import type { ReactElement } from 'react';
import { Globe, WifiOff } from 'lucide-react';
import { hostOf } from '../../utils/browserAddress';
import { openLink } from '../../utils/openLink';

/** Why a page didn't load: Chromium's own net error, and the address it was for. */
export interface PageLoadError {
  /** A net error code: -105 is a name that didn't resolve, -106 no connection. */
  code: number;
  description: string;
  url: string;
}

/** What a failed load says, in words: Chromium's net error, read as a reader would. */
function loadErrorCopy(error: PageLoadError): {
  title: string;
  body: string;
  offline: boolean;
} {
  const site = hostOf(error.url) || 'The site';
  const code = error.code;
  if (code === -106) {
    return {
      title: "You're offline",
      body: 'Check your connection, then try again.',
      offline: true,
    };
  }
  if (code === -105 || code === -137) {
    return {
      title: "Can't find this site",
      body: `${site} couldn't be found. Check the address for a typo.`,
      offline: false,
    };
  }
  if (code <= -200 && code > -300) {
    return {
      title: "This connection isn't private",
      body: `${site}'s certificate isn't trusted, so the page wasn't opened.`,
      offline: false,
    };
  }
  if (code === -7 || code === -118) {
    return {
      title: 'This site took too long',
      body: `${site} didn't answer in time. Try again in a moment.`,
      offline: false,
    };
  }
  if ([-100, -101, -102, -104, -109, -15].includes(code)) {
    return {
      title: "Couldn't reach this site",
      body: `${site} refused or dropped the connection.`,
      offline: false,
    };
  }
  if (code === -20 || code === -27 || code === -301) {
    return {
      title: "This page can't open here",
      body: 'It only opens in a browser of its own. Open it in your browser instead.',
      offline: false,
    };
  }
  return {
    title: "This page didn't load",
    body: error.description
      ? `${site}: ${error.description}`
      : `Something went wrong loading ${site}.`,
    offline: false,
  };
}

/** In place of a page that failed, which steps aside for it: why, and what to do. */
export function LoadError(props: {
  error: PageLoadError;
  onRetry: () => void;
  trackCategory: string;
}): ReactElement {
  const copy = loadErrorCopy(props.error);
  return (
    <div className='absolute inset-0 flex items-center justify-center bg-background px-6'>
      <div className='flex max-w-[400px] flex-col items-center text-center'>
        <span className='mb-4 flex size-11 items-center justify-center rounded-2xl bg-muted'>
          {copy.offline ? (
            <WifiOff className='size-5 text-muted-foreground' />
          ) : (
            <Globe className='size-5 text-muted-foreground' />
          )}
        </span>
        <h3 className='text-[15px] font-semibold text-foreground'>{copy.title}</h3>
        <p className='mt-1 text-[13px] leading-relaxed text-muted-foreground'>{copy.body}</p>
        {props.error.url && (
          <p className='mt-2 max-w-full truncate text-[11.5px] text-muted-foreground/80'>
            {props.error.url}
          </p>
        )}
        <div className='mt-5 flex items-center gap-2'>
          <button
            type='button'
            onClick={props.onRetry}
            className='flex h-8 items-center rounded-lg bg-foreground px-3.5 text-[13px] font-medium text-background outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90'
            data-track-category={props.trackCategory}
            data-track-name='EmbeddedPageRetried'
          >
            Try again
          </button>
          {props.error.url && (
            <button
              type='button'
              onClick={() => openLink(props.error.url, null, { force: 'external' })}
              className='flex h-8 items-center rounded-lg border border-border px-3.5 text-[13px] font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted'
              data-track-category={props.trackCategory}
              data-track-name='EmbeddedPageOpenedExternally'
            >
              Open in your browser
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
