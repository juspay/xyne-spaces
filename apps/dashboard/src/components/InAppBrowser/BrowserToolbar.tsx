import type { MutableRefObject, ReactElement, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Lock, RotateCw, ShieldAlert, X } from 'lucide-react';
import { AddressBar, type OpenTabSuggestion } from './AddressBar';
import { LoadingBar } from './LoadingBar';
import { ToolbarButton } from './ToolbarButton';
import type { HistorySource } from './history';

/**
 * A browser's bar: back, forward, reload — stop while loading — then the address
 * with whether the connection is secure, finding in the page when it's open, and
 * whatever else the browser adds at the end. Its foot is the page's loading bar.
 */
export function BrowserToolbar(props: {
  /** The page's address; empty on a new tab. */
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onGo: (url: string) => void;
  addressRef: MutableRefObject<HTMLInputElement | null>;
  history?: HistorySource;
  openTabs?: readonly OpenTabSuggestion[];
  onSwitchTab?: (key: string) => void;
  preconnect?: (url: string) => void;
  /** Inside the address, before it: a saved link's way back. */
  addressLeading?: ReactNode;
  /** Inside the address, after it: the page's zoom. */
  addressTrailing?: ReactNode;
  /** The find bar, while finding. */
  find?: ReactNode;
  trailing?: ReactNode;
  /** The page shown, so its loading bar starts afresh with each. */
  pageKey: string;
  onPointerEnter?: () => void;
  trackCategory: string;
}): ReactElement {
  const secure = props.url.startsWith('https:');
  const web = /^https?:/.test(props.url);
  return (
    <div
      onPointerEnter={props.onPointerEnter}
      className='relative flex h-11 shrink-0 items-center gap-0.5 border-b border-border bg-background px-2'
    >
      <ToolbarButton
        label='Back (⌘[)'
        onClick={props.onBack}
        disabled={!props.canGoBack}
        trackCategory={props.trackCategory}
        trackName='EmbeddedPageBack'
      >
        <ChevronLeft className='size-4' />
      </ToolbarButton>
      <ToolbarButton
        label='Forward (⌘])'
        onClick={props.onForward}
        disabled={!props.canGoForward}
        trackCategory={props.trackCategory}
        trackName='EmbeddedPageForward'
      >
        <ChevronRight className='size-4' />
      </ToolbarButton>
      {props.loading ? (
        <ToolbarButton
          label='Stop loading'
          onClick={props.onStop}
          trackCategory={props.trackCategory}
          trackName='EmbeddedPageStopped'
        >
          <X className='size-4' />
        </ToolbarButton>
      ) : (
        <ToolbarButton
          label='Reload (⌘R)'
          onClick={props.onReload}
          disabled={!web}
          trackCategory={props.trackCategory}
          trackName='EmbeddedPageReload'
        >
          <RotateCw className='size-3.5' />
        </ToolbarButton>
      )}
      <AddressBar
        value={props.url}
        onGo={props.onGo}
        {...(props.history && { history: props.history })}
        {...(props.openTabs && { openTabs: props.openTabs })}
        {...(props.onSwitchTab && { onSwitchTab: props.onSwitchTab })}
        {...(props.preconnect && { preconnect: props.preconnect })}
        inputRef={props.addressRef}
        trailing={props.addressTrailing}
        leading={
          <>
            {props.addressLeading}
            {web && (
              <span
                className='flex shrink-0 items-center pl-1'
                title={secure ? 'Connection is secure' : 'Connection is not secure'}
              >
                {secure ? (
                  <Lock className='size-3 text-muted-foreground' />
                ) : (
                  <ShieldAlert className='size-3.5 text-amber-500' />
                )}
              </span>
            )}
          </>
        }
        variant='bar'
        placeholder='Search or type a URL'
        trackCategory={props.trackCategory}
        trackName='EmbeddedPageAddressEdited'
      />
      {props.find}
      {props.trailing}
      <LoadingBar key={props.pageKey} loading={props.loading} />
    </div>
  );
}
