import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactElement,
} from 'react';
import {
  Check,
  Code2,
  Loader2,
  Maximize2,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import { SandpackProvider, SandpackLayout, SandpackPreview } from '@codesandbox/sandpack-react';
import {
  loadArtifactPayload,
  loadSavedArtifactPayload,
  sandpackThemeName,
  toSandpackFiles,
  withImplicitPeerDeps,
  SANDPACK_ENTRY,
} from './ReactArtifact.utils';
import type { ReactArtifactPayload, ReactArtifactViewProps } from './ReactArtifact.types';
import { ArtifactCodeView } from './ArtifactCodeView';
import { useArtifactDataBridge, type PreviewClientRef } from './useArtifactDataBridge';
import { useArtifactAgentBridge } from './useArtifactAgentBridge';
import { useArtifactDirectoryBridge } from './useArtifactDirectoryBridge';
import { ArtifactSavedIndicator } from './ArtifactSavedIndicator';
import { ArtifactBootOverlay } from './ArtifactBootOverlay';
import { ArtifactErrorOverlay } from './ArtifactErrorOverlay';
import { AppLoaderMark } from '../../AppLoader/AppLoaderMark';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { TOP_BAR_HEIGHT_CLASS } from '../../AppNavigator/topBarHeight';
// Forces Sandpack's own auto-height wrapper elements to fill the frame; see the
// file header for why `--sp-layout-height` alone is not enough.
import './sandpackOverrides.css';

/**
 * Same rules as sandpackOverrides.css, embedded so they arrive with the
 * component even when the standalone stylesheet doesn't (stale HMR graph,
 * service-worker-cached CSS chunk). The selectors are idempotent, so applying
 * both is harmless. Verified in a headless-Chrome repro of this exact DOM:
 * with these rules every sp-* layer fills the host; without them the chain
 * collapses to the iframe's bundler-reported content height.
 */
const SANDPACK_FILL_CSS = `
.xyne-artifact-sandpack { position: relative; }
.xyne-artifact-sandpack .sp-wrapper { position: absolute; inset: 0; }
.xyne-artifact-sandpack .sp-layout,
.xyne-artifact-sandpack .sp-stack,
.xyne-artifact-sandpack .sp-preview-container { height: 100%; min-height: 0; }
.xyne-artifact-sandpack .sp-layout { border: none; border-radius: 0; }
.xyne-artifact-sandpack .sp-overlay.sp-loading { display: none; }
.xyne-artifact-sandpack .sp-preview-iframe {
  height: 100% !important;
  min-height: 0 !important;
  max-height: none !important;
  flex: 1;
}
`;

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; payload: ReactArtifactPayload };

/** Inline height, chosen to match how a long code block sits in the thread:
 *  tall enough for a real UI, short enough that the reply stays scannable. */
const INLINE_HEIGHT = 420;

/**
 * The running project, isolated from the thread's render cycle.
 *
 * Sandpack's `useFiles` compares `files` / `customSetup` by REFERENCE and calls
 * `setState(getSandpackStateFromProps(props))` whenever either changes, which
 * re-registers the bundler. Building those objects inline in the parent would
 * hand it a fresh reference on every render — and the thread re-renders on
 * scroll — so the preview would restart continuously. Memoizing on `payload`
 * (stable once loaded) is what keeps the sandbox alive.
 */
const ArtifactSandpack = memo(
  ({
    payload,
    theme,
    refreshRef,
    canWrite,
    canInvokeAgents,
    currentUserId,
    appId,
    attachmentId,
    fill,
  }: {
    payload: ReactArtifactPayload;
    theme: 'light' | 'dark';
    canWrite: boolean;
    canInvokeAgents: boolean;
    /** Resolves DM names and excludes the viewer from participant lists. */
    currentUserId: string;
    appId?: string;
    /** Identifies an artifact that has not been saved yet, so it can still run
     *  agents from the chat thread it was generated in. */
    attachmentId?: string;
    /** Stable ref object — passing a changing prop here would remount the sandbox. */
    refreshRef: MutableRefObject<(() => Promise<void>) | null>;
    /** Drives the boot overlay's scale and surface. A plain boolean, so the
     *  memo's shallow compare still holds and the iframe is never torn down. */
    fill: boolean;
  }): ReactElement => {
    const previewRef = useRef<PreviewClientRef | null>(null);

    // Lives inside the memoized child so there is exactly one bridge per
    // sandbox, paired with its own iframe — true for the inline card, the
    // dialog and the saved-app screen alike.
    useArtifactDataBridge({
      requirements: payload.dataRequirements,
      canWrite,
      ...(appId ? { appId } : {}),
      previewRef,
      refreshRef,
    });

    // Separate from the data bridge: agent runs outlive the app and must not be
    // torn down with it, and an agent-only app declares no data requirements.
    useArtifactAgentBridge({
      canInvokeAgents,
      ...(appId ? { appId } : {}),
      ...(attachmentId ? { attachmentId } : {}),
      previewRef,
    });

    // Ids are opaque and two of the naming rules are not guessable, so the host
    // resolves them with the app's own helpers rather than letting generated
    // code join a user table and get it wrong.
    useArtifactDirectoryBridge({ currentUserId, previewRef });

    const files = useMemo(() => toSandpackFiles(payload), [payload]);
    const customSetup = useMemo(
      () => ({
        dependencies: withImplicitPeerDeps(payload.dependencies),
        // NOT payload.entry — that names the root *component* file, which
        // exports a component but never mounts it. Booting the bundler from it
        // produces a clean build and a blank page.
        entry: SANDPACK_ENTRY,
      }),
      [payload],
    );

    return (
      <SandpackProvider template='react-ts' theme={theme} files={files} customSetup={customSetup}>
        <SandpackLayout>
          {/* Sandpack's error overlay is replaced by ArtifactErrorOverlay below,
              which shows the same failure with a way to act on it. */}
          <SandpackPreview
            ref={previewRef}
            showOpenInCodeSandbox={false}
            showSandpackErrorOverlay={false}
          />
        </SandpackLayout>
        <ArtifactBootOverlay fill={fill} />
        <ArtifactErrorOverlay fill={fill} previewRef={previewRef} />
      </SandpackProvider>
    );
  },
);
ArtifactSandpack.displayName = 'ArtifactSandpack';

/**
 * The generated project, running. Rendered inline in the thread by default and
 * with `fill` inside the side panel — the same Sandpack either way, only the
 * sizing differs.
 *
 * Sandpack does not bundle in-page — the preview is an iframe whose document is
 * served by the CodeSandbox bundler, so it needs `frame-src`/`connect-src` to
 * allow that origin. The Electron shell injects its own CSP
 * (apps/electron/src/services/request-interceptor.ts) and must list it too.
 */
export const ReactArtifactView = ({
  artifact,
  fill = false,
  onExpand,
  expandLabel = 'Open full screen',
  onClose,
  titleSlot,
  onSave,
  saveState = 'idle',
}: ReactArtifactViewProps): ReactElement => {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [refreshingData, setRefreshingData] = useState(false);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const auth = useAuthContextValues();
  const theme = useMemo(() => sandpackThemeName(), []);
  const { attachmentId, inlineData, savedAppId, versionId } = artifact;

  // Keyed on the ids, NOT on `artifact`: callers rebuild that object each
  // render, and depending on its identity would re-enter `loading` — tearing
  // down the whole Sandpack subtree — every time the thread re-rendered.
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    // Inline bytes win when present: the artifact was just generated in this
    // session, so they are already here and exactly what this turn produced —
    // fetching would be a needless round trip against a row written moments ago.
    // Otherwise address the app by id, the only route that works for someone who
    // was never in the originating chat, pinned to THIS turn's version so a card
    // keeps rendering what its message described even after later generations
    // move the app on.
    const load = inlineData
      ? loadArtifactPayload({ attachmentId, inlineData })
      : savedAppId
        ? loadSavedArtifactPayload(savedAppId, versionId)
        : loadArtifactPayload({ attachmentId });

    load
      .then(payload => {
        if (!cancelled) setState({ status: 'ready', payload });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load this artifact.',
        });
      });

    return (): void => {
      cancelled = true;
    };
  }, [attachmentId, inlineData, savedAppId, versionId]);

  const shellClass = fill
    ? 'flex h-full min-h-0 flex-1 flex-col'
    : 'my-3 flex flex-col overflow-hidden rounded-lg border border-border bg-card';
  const bodyStyle: CSSProperties = fill ? { flex: 1, minHeight: 0 } : { height: INLINE_HEIGHT };

  if (state.status !== 'ready') {
    return (
      <div className={shellClass}>
        <div
          className='flex flex-col items-center justify-center gap-2 p-6 text-center'
          style={bodyStyle}
        >
          {state.status === 'loading' ? (
            // Same mark the sandbox overlay uses, so fetching the payload and
            // booting the bundler read as one wait instead of two loaders
            // swapping places.
            <div role='status' aria-label='Loading app'>
              <AppLoaderMark size={fill ? 'md' : 'sm'} />
            </div>
          ) : (
            <>
              <p className='text-sm font-medium text-foreground'>Could not open this app</p>
              <p className='text-xs text-muted-foreground'>{state.message}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const { payload } = state;

  return (
    <div className={shellClass} data-testid='react-artifact'>
      <div
        className={`flex items-center justify-between gap-2 border-b px-3 ${
          // Only when filling a panel does this sit on the same row as the
          // AppNavigator, so it has to match both its height and its seam
          // colour. Inline in a transcript it is a card header, not a top bar:
          // content-sized, with the ordinary card border.
          fill
            ? // Filling a panel, this sits on the same row as the chat's own
              // top bar, which reads white because it is transparent over a
              // `bg-background` panel. The pane's shell has no background of
              // its own, so state it here or the window grey shows through and
              // the two headers do not match across the split.
              `${TOP_BAR_HEIGHT_CLASS} border-sidebar-border-muted bg-background`
            : 'border-border py-2'
        }`}
      >
        {titleSlot ?? (
          <span className='truncate text-sm font-medium text-foreground'>{payload.title}</span>
        )}

        {/* One group, so the bar reads as title | actions. Without it,
            justify-between spreads every control evenly across the header. */}
        <div className='flex shrink-0 items-center gap-1'>
          {fill && (
            <div className='flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5'>
              {/* eslint-disable-next-line @typescript-eslint/naming-convention -- JSX component refs must be PascalCase */}
              {(
                [
                  ['preview', Play],
                  ['code', Code2],
                ] as const
              ).map(([value, Icon]) => (
                <button
                  key={value}
                  type='button'
                  onClick={() => setTab(value)}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium capitalize transition-colors ${
                    tab === value
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  data-track-category='AskAI'
                  data-track-name='ReactArtifactTab'
                  data-track-metadata={JSON.stringify({ tab: value })}
                >
                  <Icon className='h-3.5 w-3.5' aria-hidden='true' />
                  {value}
                </button>
              ))}
            </div>
          )}
          {payload.invokesAgents && (
            <span
              className='flex shrink-0 items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400'
              title='This app can run an AI agent as you. Runs continue if you close the app.'
            >
              <Sparkles className='h-3 w-3' aria-hidden='true' />
              Uses AI agents
            </span>
          )}
          {payload.writes && (
            <span
              className='flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400'
              title='This app can change data in your workspace. Changes are immediate and cannot be undone.'
            >
              <Pencil className='h-3 w-3' aria-hidden='true' />
              Can make changes
            </span>
          )}
          {savedAppId && (
            <ArtifactSavedIndicator appId={savedAppId} {...(versionId ? { versionId } : {})} />
          )}
          {payload.dataRequirements?.some(r => r.source) && (
            <Button
              variant='ghost'
              trackId='react_artifact_refresh_data'
              type='button'
              onClick={() => {
                setRefreshingData(true);
                void refreshRef.current?.().finally(() => setRefreshingData(false));
              }}
              disabled={refreshingData}
              className='shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60'
              aria-label='Refresh data'
              title='Refresh data'
              data-track-category='AskAI'
              data-track-name='ReactArtifactRefreshData'
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshingData ? 'animate-spin' : ''}`}
                aria-hidden='true'
              />
            </Button>
          )}
          {onSave && (
            <Button
              variant='ghost'
              trackId='react_artifact_save'
              type='button'
              onClick={() => onSave(artifact)}
              disabled={saveState !== 'idle'}
              className='shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-60'
              aria-label={saveState === 'saved' ? 'Saved' : 'Save app'}
              title={saveState === 'saved' ? 'Saved to your apps' : 'Save app'}
              data-track-category='AskAI'
              data-track-name='ReactArtifactSave'
            >
              {saveState === 'saving' ? (
                <Loader2 className='h-3.5 w-3.5 animate-spin' aria-hidden='true' />
              ) : saveState === 'saved' ? (
                <Check className='h-3.5 w-3.5 text-emerald-500' aria-hidden='true' />
              ) : (
                <Save className='h-3.5 w-3.5' aria-hidden='true' />
              )}
            </Button>
          )}
          {onExpand && (
            <button
              type='button'
              onClick={() => onExpand(artifact)}
              className='shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              aria-label={expandLabel}
              title={expandLabel}
              data-track-category='AskAI'
              data-track-name='ReactArtifactExpand'
            >
              <Maximize2 className='h-3.5 w-3.5' aria-hidden='true' />
            </button>
          )}
          {onClose && (
            <button
              type='button'
              onClick={onClose}
              className='shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              aria-label='Close'
              data-track-category='AskAI'
              data-track-name='ReactArtifactClose'
            >
              <X className='h-4 w-4' aria-hidden='true' />
            </button>
          )}
        </div>
      </div>

      {/* `--sp-layout-height` is the height Sandpack gives `.sp-stack` (default
          300px). It only resolves to something useful once its auto-height
          ancestors are made definite — that is what sandpackOverrides.css does. */}
      <div
        className='xyne-artifact-sandpack'
        style={
          {
            ...bodyStyle,
            ['--sp-layout-height' as string]: '100%',
            display: tab === 'preview' ? undefined : 'none',
          } as CSSProperties
        }
      >
        <style>{SANDPACK_FILL_CSS}</style>
        <ArtifactSandpack
          payload={payload}
          theme={theme}
          refreshRef={refreshRef}
          fill={fill}
          canWrite
          canInvokeAgents
          currentUserId={auth.userID ?? ''}
          {...(artifact.savedAppId ? { appId: artifact.savedAppId } : {})}
          {...(!artifact.savedAppId && attachmentId ? { attachmentId } : {})}
        />
      </div>
      {fill && tab === 'code' && (
        <div style={bodyStyle}>
          <ArtifactCodeView payload={payload} />
        </div>
      )}
    </div>
  );
};
