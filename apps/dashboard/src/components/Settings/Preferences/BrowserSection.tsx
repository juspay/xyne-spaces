import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Tooltip } from '../../ui/Tooltip';
import { Switch } from '../../ui/Switch';
import { setUserPreference, useUserPreference } from '../../../machines/userPreferencesMachine';
import { homePageFor, hostOf } from '../../../utils/browserAddress';
import {
  clearBrowserSiteData,
  importBrowserSignIns,
  listImportBrowsers,
  listImportProfiles,
  openBrowserAccessSettings,
  type BrowserImportBrowser,
  type BrowserImportFailure,
  type BrowserImportProfile,
} from '../../../utils/browserSessions';
import { cn } from '../../../utils/classNames';
import { canClearBrowsingHistory, clearBrowsingHistory } from '../../InAppBrowser';

const CARD = 'p-3 rounded-lg border border-border bg-muted/30';

/** When an import last ran, as a reader would say it. */
function importedAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** What went wrong, in one plain sentence. */
function failureMessage(reason: BrowserImportFailure, browser: BrowserImportBrowser): string {
  if (reason === 'needs-access') {
    return browser.browser === 'safari'
      ? 'Requires Full Disk Access. Turn it on for Xyne, then reopen Xyne.'
      : // As System Settings shows it: a switch for the browser under Xyne.
        `Access to ${browser.browserName} is off. In Files & Folders, turn on ${browser.browserName} under Xyne.`;
  }
  if (reason === 'keychain-denied')
    return 'Keychain access was denied. Try again and choose Allow.';
  if (reason === 'unsupported-platform') return 'Not available on this platform.';
  return 'Import failed. Try again.';
}

/** A browser's own app icon, or its first letter where the app wasn't found. */
function BrowserIcon(props: { browser: BrowserImportBrowser }): ReactElement {
  const [broken, setBroken] = useState(false);
  if (props.browser.icon && !broken) {
    return (
      <img
        src={props.browser.icon}
        alt=''
        className='size-8 shrink-0 object-contain'
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-[13px] font-semibold text-muted-foreground ring-1 ring-border'>
      {props.browser.browserName.replace(/^(Google|Microsoft) /, '').charAt(0)}
    </span>
  );
}

type RowState =
  | { kind: 'idle' }
  /** Opening the browser's data, where macOS may ask for access. */
  | { kind: 'opening' }
  | { kind: 'importing'; label: string }
  | { kind: 'imported'; label: string; sites: number }
  | { kind: 'failed'; reason: BrowserImportFailure };

/**
 * One browser, with one control. Import opens its data — macOS asks for access the
 * first time — and brings in its only profile; where it has several, the control
 * becomes "Choose profile", a menu of them and all of them together.
 */
function BrowserRow(props: { browser: BrowserImportBrowser }): ReactElement {
  const { browser } = props;
  const imports = useUserPreference('browserImports');
  const [state, setState] = useState<RowState>({ kind: 'idle' });
  const [profiles, setProfiles] = useState<BrowserImportProfile[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Settings opened to turn access on: what's left is to try again — except Safari,
  // whose Full Disk Access only holds once Xyne reopens.
  const [settingsOpened, setSettingsOpened] = useState(false);

  // The latest import of any of its profiles.
  const last = Object.entries(imports)
    .filter(([id]) => id.startsWith(`${browser.browser}:`))
    .map(([, entry]) => entry)
    .sort((a, b) => b.at - a.at)[0];

  /** Imports the profiles given, one after another, saying which as it goes. */
  const importProfiles = async (chosen: readonly BrowserImportProfile[]): Promise<void> => {
    let sites = 0;
    for (const [index, profile] of chosen.entries()) {
      setState({
        kind: 'importing',
        label: chosen.length > 1 ? `${index + 1} of ${chosen.length}` : profile.profile,
      });
      const outcome = await importBrowserSignIns(profile.id);
      if (!outcome.ok) {
        setState({ kind: 'failed', reason: outcome.reason });
        return;
      }
      sites += outcome.sites;
    }
    const [only] = chosen;
    setState({
      kind: 'imported',
      label: chosen.length === 1 && only ? only.profile : `${chosen.length} profiles`,
      sites,
    });
  };

  const start = async (): Promise<void> => {
    setState({ kind: 'opening' });
    const found = await listImportProfiles(browser.browser);
    if (!found.ok) {
      setState({ kind: 'failed', reason: found.reason });
      return;
    }
    setProfiles(found.profiles);
    setState({ kind: 'idle' });
    if (found.profiles.length === 1) await importProfiles(found.profiles);
    else if (found.profiles.length > 1) setMenuOpen(true);
  };

  const busy = state.kind === 'opening' || state.kind === 'importing';
  const status =
    state.kind === 'opening'
      ? 'Opening…'
      : state.kind === 'importing'
        ? `Importing ${state.label}…`
        : state.kind === 'imported'
          ? `Imported ${state.label} · ${state.sites.toLocaleString()} sites`
          : state.kind === 'failed'
            ? failureMessage(state.reason, browser)
            : profiles?.length === 0
              ? 'No sign-ins found.'
              : last
                ? `Imported ${importedAgo(last.at)} · ${last.sites.toLocaleString()} sites`
                : 'Not imported';

  let control: ReactElement | null;
  if (
    state.kind === 'failed' &&
    state.reason === 'needs-access' &&
    !(settingsOpened && browser.browser !== 'safari')
  ) {
    control = (
      <Button
        variant='outline'
        size='sm'
        onClick={() => {
          openBrowserAccessSettings(browser.browser);
          setSettingsOpened(true);
        }}
        data-track-category='PREFERENCES'
        data-track-name='BrowserImportOpenSettings'
        data-track-metadata={JSON.stringify({ browser: browser.browser })}
      >
        Open Settings
      </Button>
    );
  } else if (state.kind === 'failed' && state.reason === 'needs-access') {
    control = (
      <Button
        variant='outline'
        size='sm'
        onClick={() => {
          setSettingsOpened(false);
          void start();
        }}
        data-track-category='PREFERENCES'
        data-track-name='BrowserImportRetried'
        data-track-metadata={JSON.stringify({ browser: browser.browser })}
      >
        Try again
      </Button>
    );
  } else if (profiles && profiles.length > 1) {
    control = (
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant='outline'
            size='sm'
            loading={busy}
            disabled={busy}
            data-track-category='PREFERENCES'
            data-track-name='BrowserImportProfilesOpened'
            data-track-metadata={JSON.stringify({ browser: browser.browser })}
          >
            Choose profile
            {!busy && <ChevronDown className='size-3.5 opacity-70' />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-64'>
          <DropdownMenuLabel className='text-xs font-medium text-muted-foreground'>
            Import from
          </DropdownMenuLabel>
          {profiles.map(profile => {
            const imported = imports[profile.id];
            return (
              <DropdownMenuItem
                key={profile.id}
                onSelect={() => void importProfiles([profile])}
                className='flex flex-col items-start gap-0.5'
                data-track-category='PREFERENCES'
                data-track-name='BrowserImportProfile'
                data-track-metadata={JSON.stringify({ browser: browser.browser })}
              >
                <span className='w-full truncate text-sm'>
                  {profile.profile}
                  {profile.account && (
                    <span className='text-muted-foreground'> · {profile.account}</span>
                  )}
                </span>
                <span className='text-xs text-muted-foreground'>
                  {imported ? `Imported ${importedAgo(imported.at)}` : 'Not imported'}
                </span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void importProfiles(profiles)}
            className='text-sm'
            data-track-category='PREFERENCES'
            data-track-name='BrowserImportAllProfiles'
            data-track-metadata={JSON.stringify({ browser: browser.browser })}
          >
            All profiles
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  } else if (profiles?.length === 0) {
    control = null;
  } else {
    control = (
      <Button
        variant='outline'
        size='sm'
        loading={busy}
        disabled={busy}
        onClick={() => void (profiles?.length === 1 ? importProfiles(profiles) : start())}
        data-track-category='PREFERENCES'
        data-track-name='BrowserImportStarted'
        data-track-metadata={JSON.stringify({ browser: browser.browser })}
      >
        {last ? 'Import again' : 'Import'}
      </Button>
    );
  }

  return (
    <div className='flex items-center gap-3 py-2.5'>
      <BrowserIcon browser={browser} />
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium text-foreground'>{browser.browserName}</p>
        <p
          className={cn(
            'mt-0.5 line-clamp-2 text-xs',
            // Access to grant is a step to take, not an error; a failed import is one.
            state.kind === 'failed' && state.reason !== 'needs-access'
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {status}
        </p>
      </div>
      {control}
    </div>
  );
}

/** Where a folder's browser opens for Xyne AI: kept on this device. */
/** Whether a playing video floats in its own window when its tab is left. */
function PictureInPictureCard(): ReactElement {
  const enabled = useUserPreference('browserAutoPictureInPicture');
  return (
    <div className={cn(CARD, 'flex items-center justify-between gap-4')}>
      <div>
        <p className='text-sm font-medium text-foreground'>Picture in picture</p>
        <p className='mt-0.5 text-xs text-muted-foreground'>
          Keep a playing video in a floating window when you switch tabs or hide the browser.
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(checked: boolean) =>
          setUserPreference('browserAutoPictureInPicture', checked)
        }
        aria-label='Picture in picture'
        data-track-category='PREFERENCES'
        data-track-name='BrowserPictureInPictureToggled'
      />
    </div>
  );
}

function HomePageCard(): ReactElement {
  const homePage = useUserPreference('sdlcBrowserHomePage');
  const [draft, setDraft] = useState(homePage);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setDraft(homePage), [homePage]);
  const changed = draft.trim() !== homePage;

  const save = (): void => {
    const url = homePageFor(draft);
    if (!url) {
      setInvalid(true);
      return;
    }
    setUserPreference('sdlcBrowserHomePage', url);
    toast.success(`Home page set to ${hostOf(url) || url}`);
  };

  return (
    <div className={cn(CARD, 'space-y-2')}>
      <div>
        <p className='text-sm font-medium text-foreground'>Home page</p>
        <p className='mt-0.5 text-xs text-muted-foreground'>
          Where the browser opens when Xyne AI browses for you.
        </p>
      </div>
      <form
        className='flex items-center gap-2'
        onSubmit={event => {
          event.preventDefault();
          save();
        }}
      >
        <input
          value={draft}
          onChange={event => {
            setInvalid(false);
            setDraft(event.target.value);
          }}
          aria-label='Home page'
          aria-invalid={invalid}
          spellCheck={false}
          className={cn(
            'h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm text-foreground outline-none focus:ring-1',
            invalid ? 'border-destructive focus:ring-destructive' : 'border-border focus:ring-ring',
          )}
          data-track-category='PREFERENCES'
          data-track-name='BrowserHomePageTyped'
        />
        <Button
          type='submit'
          variant='outline'
          size='sm'
          disabled={!changed}
          data-track-category='PREFERENCES'
          data-track-name='BrowserHomePageSaved'
        >
          Save
        </Button>
      </form>
      {invalid && <p className='text-xs text-destructive'>Enter a web address, like google.com.</p>}
    </div>
  );
}

/** Signing out of every outside site, once confirmed. */
function ClearSiteDataCard(): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  const clear = async (): Promise<void> => {
    setClearing(true);
    const cleared = await clearBrowserSiteData();
    setClearing(false);
    setConfirming(false);
    if (cleared) toast.success('Signed out of all sites');
    else toast.error("Couldn't clear site data");
  };

  return (
    <div className={cn(CARD, 'flex items-center justify-between gap-4')}>
      <div>
        <p className='text-sm font-medium text-foreground'>Clear site data</p>
        <p className='mt-0.5 text-xs text-muted-foreground'>
          {confirming
            ? 'You’ll be signed out of all sites. Your Xyne account stays signed in.'
            : 'Sign out of all sites in the built-in browser.'}
        </p>
      </div>
      {confirming ? (
        <div className='flex shrink-0 items-center gap-2'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setConfirming(false)}
            data-track-category='PREFERENCES'
            data-track-name='BrowserClearSiteDataCancelled'
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            size='sm'
            loading={clearing}
            disabled={clearing}
            onClick={() => void clear()}
            data-track-category='PREFERENCES'
            data-track-name='BrowserClearSiteData'
          >
            Clear
          </Button>
        </div>
      ) : (
        <Button
          variant='outline'
          size='sm'
          onClick={() => setConfirming(true)}
          data-track-category='PREFERENCES'
          data-track-name='BrowserClearSiteDataOpened'
        >
          Clear…
        </Button>
      )}
    </div>
  );
}

/**
 * Forgetting where the built-in browser has been, once confirmed. Only where the
 * desktop app keeps that history.
 */
function ClearHistoryCard(): ReactElement | null {
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  if (!canClearBrowsingHistory()) return null;

  const clear = async (): Promise<void> => {
    setClearing(true);
    const cleared = await clearBrowsingHistory();
    setClearing(false);
    setConfirming(false);
    if (cleared) toast.success('Browsing history cleared');
    else toast.error("Couldn't clear browsing history");
  };

  return (
    <div className={cn(CARD, 'flex items-center justify-between gap-4')}>
      <div>
        <p className='text-sm font-medium text-foreground'>Browsing history</p>
        <p className='mt-0.5 text-xs text-muted-foreground'>
          {confirming
            ? 'All visited pages and searches will be removed from this computer.'
            : 'Used for address bar suggestions. Stored encrypted on this computer.'}
        </p>
      </div>
      {confirming ? (
        <div className='flex shrink-0 items-center gap-2'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setConfirming(false)}
            data-track-category='PREFERENCES'
            data-track-name='BrowserClearHistoryCancelled'
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            size='sm'
            loading={clearing}
            disabled={clearing}
            onClick={() => void clear()}
            data-track-category='PREFERENCES'
            data-track-name='BrowserClearHistory'
          >
            Clear
          </Button>
        </div>
      ) : (
        <Button
          variant='outline'
          size='sm'
          onClick={() => setConfirming(true)}
          data-track-category='PREFERENCES'
          data-track-name='BrowserClearHistoryOpened'
        >
          Clear…
        </Button>
      )}
    </div>
  );
}

/**
 * Preferences → Browser: the browsers on this computer, each ready to bring its
 * sign-ins into Xyne's built-in browser — in folders, the browser panel and Xyne AI's
 * workspace — plus where that browser starts, and a way to sign out of everything.
 */
export function BrowserSection(): ReactElement {
  const [found, setFound] = useState<{
    supported: boolean;
    browsers: BrowserImportBrowser[];
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const find = useCallback(() => {
    setChecking(true);
    void listImportBrowsers()
      .then(setFound)
      .finally(() => setChecking(false));
  }, []);
  useEffect(find, [find]);

  return (
    <div className='space-y-4'>
      <div>
        <p className='text-base font-semibold text-foreground'>Browser</p>
        <p className='mt-0.5 text-sm text-muted-foreground'>
          Sign-ins and site data for the built-in browser
        </p>
      </div>

      <div className={CARD}>
        <div className='flex items-center justify-between gap-4'>
          <p className='text-sm font-medium text-foreground'>Import sign-ins</p>
          {found?.supported !== false && (
            <Tooltip content='Find browsers installed since this opened'>
              <Button
                variant='ghost'
                size='sm'
                loading={checking}
                disabled={checking}
                onClick={find}
                className='shrink-0'
                data-track-category='PREFERENCES'
                data-track-name='BrowserImportRescan'
              >
                {!checking && <RefreshCw className='size-3.5' />}
                Check for browsers
              </Button>
            </Tooltip>
          )}
        </div>
        {found?.supported === false ? (
          <p className='mt-0.5 text-xs text-muted-foreground'>
            Importing sign-ins isn&apos;t available on this platform.
          </p>
        ) : (
          <>
            <p className='mt-0.5 text-xs text-muted-foreground'>
              Use your sign-ins from other browsers in Xyne. Import again to include new ones.
            </p>
            <div className='mt-2 divide-y divide-border'>
              {found === null ? (
                <p className='py-3 text-xs text-muted-foreground'>Looking for browsers…</p>
              ) : found.browsers.length === 0 ? (
                <p className='py-3 text-xs text-muted-foreground'>No other browsers found.</p>
              ) : (
                found.browsers.map(browser => (
                  <BrowserRow key={browser.browser} browser={browser} />
                ))
              )}
            </div>
          </>
        )}
      </div>

      <HomePageCard />
      <PictureInPictureCard />
      <ClearHistoryCard />
      <ClearSiteDataCard />
    </div>
  );
}
