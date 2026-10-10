import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { hostOf } from '../../utils/browserAddress';
import { AddressBar, type OpenTabSuggestion } from './AddressBar';
import type { BrowserHistoryPage, HistorySource } from './history';

/** A site's letter, for a tile with no icon: its name's, not a subdomain's — W for
 *  en.wikipedia.org, S for docs.stripe.com. */
export function siteLetter(host: string): string {
  const parts = host.split('.').filter(Boolean);
  const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return (name ?? '').charAt(0).toUpperCase() || '·';
}

/** A site's tile: its own icon, or its first letter where it has none. */
export function SiteTile(props: {
  favicon: string | null | undefined;
  host: string;
}): ReactElement {
  const [broken, setBroken] = useState(false);
  return (
    <span className='flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted ring-1 ring-border/60 transition-shadow group-hover:shadow-sm'>
      {props.favicon && !broken ? (
        <img
          src={props.favicon}
          alt=''
          className='size-5 rounded-[3px] object-contain'
          onError={() => setBroken(true)}
        />
      ) : (
        <span className='text-[15px] font-semibold text-muted-foreground'>
          {siteLetter(props.host)}
        </span>
      )}
    </span>
  );
}

/** A row of site tiles, each a click from its page. */
export function SiteTiles(props: {
  sites: readonly { key: string; url: string; name: string; favicon: string | null | undefined }[];
  onOpen: (key: string) => void;
  trackCategory: string;
  trackName: string;
}): ReactElement {
  return (
    <div className='grid grid-cols-2 gap-1 sm:grid-cols-4'>
      {props.sites.map(site => {
        const host = hostOf(site.url);
        return (
          <button
            key={site.key}
            type='button'
            onClick={() => props.onOpen(site.key)}
            title={`${site.name}\n${site.url}`}
            className='group flex min-w-0 flex-col items-center gap-2 rounded-xl px-2 py-3 text-center outline-none transition-colors hover:bg-muted/70 focus-visible:bg-muted/70'
            data-track-category={props.trackCategory}
            data-track-name={props.trackName}
          >
            <SiteTile favicon={site.favicon} host={host} />
            <span className='w-full min-w-0'>
              <span className='block truncate text-[12.5px] text-foreground'>{site.name}</span>
              <span className='block truncate text-[11px] text-muted-foreground'>{host}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The sites visited most, from the browsing history; nothing until there are some. */
export function MostVisited(props: {
  history: HistorySource;
  onGo: (url: string) => void;
  trackCategory: string;
}): ReactElement | null {
  const [sites, setSites] = useState<BrowserHistoryPage[]>([]);
  useEffect(() => {
    let current = true;
    void props.history.top(8).then(found => {
      if (current) setSites(found);
    });
    return () => {
      current = false;
    };
  }, [props.history]);
  if (sites.length === 0) return null;
  return (
    <StartSection title='Most visited'>
      <SiteTiles
        sites={sites.map(site => ({
          key: site.url,
          url: site.url,
          name: site.title || hostOf(site.url),
          favicon: site.favicon,
        }))}
        onOpen={props.onGo}
        trackCategory={props.trackCategory}
        trackName='BrowserStartSiteOpened'
      />
    </StartSection>
  );
}

export function StartSection(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className='mt-10 first:mt-12'>
      <h3 className='mb-3 px-1 text-[11.5px] font-medium text-muted-foreground'>{props.title}</h3>
      {props.children}
    </section>
  );
}

function StartKey(props: { keys: string; label: string }): ReactElement {
  return (
    <span className='flex items-center gap-1.5'>
      <kbd className='rounded border border-border bg-muted px-1.5 py-px font-sans text-[11px] text-muted-foreground'>
        {props.keys}
      </kbd>
      {props.label}
    </span>
  );
}

/**
 * A browser's new tab: one box to search or type an address — offering the history
 * and open tabs as it is typed in — then whatever the browser shows beneath it, and
 * the keys that get around.
 */
export function StartPage(props: {
  /** Above the box: where this is browsing from. */
  heading?: ReactNode;
  /** Under the box. */
  note?: ReactNode;
  onGo: (url: string) => void;
  history?: HistorySource;
  openTabs?: readonly OpenTabSuggestion[];
  onSwitchTab?: (key: string) => void;
  preconnect?: (url: string) => void;
  children?: ReactNode;
  /** At the foot, above the keys. */
  footer?: ReactNode;
  keys: readonly { keys: string; label: string }[];
  trackCategory: string;
}): ReactElement {
  return (
    <div className='flex h-full flex-col overflow-y-auto bg-background'>
      <div className='mx-auto flex w-full max-w-[640px] flex-1 flex-col px-6 pb-8 pt-[11vh]'>
        {props.heading && (
          <div className='mb-5 flex items-center justify-center gap-2 text-[13px] text-muted-foreground'>
            {props.heading}
          </div>
        )}
        <AddressBar
          value=''
          onGo={props.onGo}
          {...(props.history && { history: props.history })}
          {...(props.openTabs && { openTabs: props.openTabs })}
          {...(props.onSwitchTab && { onSwitchTab: props.onSwitchTab })}
          {...(props.preconnect && { preconnect: props.preconnect })}
          variant='hero'
          placeholder='Search Google or type a URL'
          autoFocus
          trackCategory={props.trackCategory}
          trackName='BrowserStartSearched'
        />
        {props.note && (
          <p className='mt-3 text-center text-[12.5px] text-muted-foreground'>{props.note}</p>
        )}
        {props.children}
        <div className='mt-auto pt-12'>{props.footer}</div>
        <div className='flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-4 text-[11.5px] text-muted-foreground'>
          {props.keys.map(key => (
            <StartKey key={key.keys} keys={key.keys} label={key.label} />
          ))}
        </div>
      </div>
    </div>
  );
}
