import {
  ReactElement,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import {
  AlertTriangle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SendPlaneSlant,
} from '@/components/ClawAgents/digitalTwin/icons';
import { DigitalTwinComposerPlusMenu } from '@/components/ClawAgents/digitalTwin/DigitalTwinComposerPlusMenu';
import { DigitalTwinChatOverlay } from '@/components/ClawAgents/digitalTwin/DigitalTwinChatOverlay';
import {
  EMPTY_COMPOSER_CONTEXT,
  type ComposerContext,
} from '@/components/AIScreen/composerContext';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ComposerVoiceButton } from '@/components/AIScreen/ComposerVoiceButton';
import {
  useClawDigitalTwinStatus,
  useClawDigitalTwinPipelineEvents,
  usePauseDigitalTwinBackfill,
  useResumeDigitalTwinBackfill,
} from '@/hooks/useClawDigitalTwin';
import { useSelectedAgent } from '@/hooks/useSelectedAgent';
import { DigitalTwinEnablePanel } from '@/components/ClawAgents/digitalTwin/DigitalTwinEnablePanel';
import { EnableModal } from '@/components/ClawAgents/digitalTwin/EnableModal';
import { UploadModal } from '@/components/ClawAgents/digitalTwin/UploadModal';
import {
  DIGITAL_TWIN_EASE_IN,
  DIGITAL_TWIN_EASE_OUT,
  DIGITAL_TWIN_MOTION,
} from '@/components/ClawAgents/digitalTwin/motion';
import { xyneAIActor } from '@/machines/xyneAIMachine';
import '@/components/ClawAgents/digitalTwin/digital-twin.css';
import '@/components/ClawAgents/digitalTwin/digital-twin-motion.css';

const BASE = '/claw-agents/digital-twin';
const TWIN_AGENT_SLUG = 'digital-twin';
const TWIN_PORTRAIT_SRC = '/images/digital-twin-portrait.png';

const ASK_ICON_CLASS =
  'dt-pressable inline-flex size-7 shrink-0 items-center justify-center rounded-full text-foreground/70';
const ASK_CONTROL_SIZE = 28;
const ASK_CONTROL_GAP = 4;
const ASK_TEXTAREA_MIN = 28;
const ASK_TEXTAREA_MAX = 100;
const ASK_TEXTAREA_CLASS =
  'min-h-7 min-w-0 w-full resize-none bg-transparent px-1 text-sm font-[450] tracking-[-0.28px] text-foreground [overflow-wrap:anywhere] placeholder:text-foreground/40 focus:outline-none';
const ASK_RADIUS_PILL = 18;
const ASK_RADIUS_EXPANDED = 18;

const DigitalTwinNavLabel = ({
  label,
  isActive,
}: {
  label: string;
  isActive: boolean;
}): ReactElement => (
  <>
    {isActive && (
      <motion.span
        layoutId='digital-twin-active-tab'
        className='absolute inset-0 -z-10 rounded-[10px] bg-foreground/[0.06]'
        transition={{ duration: DIGITAL_TWIN_MOTION.layout, ease: DIGITAL_TWIN_EASE_OUT }}
      />
    )}
    <span>{label}</span>
  </>
);

const DigitalTwinAskComposer = ({
  inputId,
  value,
  onValueChange,
  extras,
  onExtrasChange,
  onAsk,
  onUpload,
  fullWidth = false,
}: {
  inputId: string;
  value: string;
  onValueChange: Dispatch<SetStateAction<string>>;
  extras: ComposerContext;
  onExtrasChange: Dispatch<SetStateAction<ComposerContext>>;
  onAsk: (text: string, extras: ComposerContext) => void;
  onUpload: () => void;
  fullWidth?: boolean;
}): ReactElement => {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const [heightMotionReady, setHeightMotionReady] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canSend = value.trim().length > 0;

  const insertSnippet = useCallback(
    (snippet: string): void => {
      const el = inputRef.current;
      if (!el) {
        onValueChange(current => `${current}${snippet}`);
        return;
      }
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      onValueChange(current => `${current.slice(0, start)}${snippet}${current.slice(end)}`);
      requestAnimationFrame(() => {
        el.focus();
        const next = start + snippet.length;
        el.setSelectionRange(next, next);
      });
    },
    [onValueChange],
  );

  const submit = useCallback((): void => {
    const text = value.trim();
    if (!text) return;
    onAsk(text, extras);
    onValueChange('');
  }, [extras, onAsk, onValueChange, value]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  useLayoutEffect(() => {
    const input = inputRef.current;
    const controls = controlsRef.current;
    const measure = measureRef.current;
    if (!input || !controls || !measure) return;

    const sync = (): void => {
      const inlineInputWidth = controls.clientWidth - ASK_CONTROL_SIZE * 3 - ASK_CONTROL_GAP * 3;
      const needsFullWidth =
        value.length > 0 &&
        inlineInputWidth > 0 &&
        (value.includes('\n') || measure.offsetWidth + 8 > inlineInputWidth);
      if (needsFullWidth !== expanded) {
        setExpanded(needsFullWidth);
      }

      if (needsFullWidth) {
        input.style.height = '0px';
        const contentHeight = input.scrollHeight;
        input.style.height = `${Math.min(Math.max(contentHeight, ASK_TEXTAREA_MIN), ASK_TEXTAREA_MAX)}px`;
        input.style.overflowY = contentHeight > ASK_TEXTAREA_MAX ? 'auto' : 'hidden';
      } else {
        input.style.height = `${ASK_TEXTAREA_MIN}px`;
        input.style.overflowY = 'hidden';
      }

      const form = formRef.current;
      const shell = shellRef.current;
      if (form && shell) {
        const styles = getComputedStyle(form);
        const nextHeight = Math.round(
          shell.offsetHeight +
            parseFloat(styles.borderTopWidth) +
            parseFloat(styles.borderBottomWidth) +
            parseFloat(styles.paddingTop) +
            parseFloat(styles.paddingBottom),
        );
        setComposerHeight(current => (current === nextHeight ? current : nextHeight));
      }
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(controls);
    return (): void => observer.disconnect();
  }, [expanded, value]);

  useLayoutEffect(() => {
    if (composerHeight === null || heightMotionReady) return;
    setHeightMotionReady(true);
  }, [composerHeight, heightMotionReady]);

  const askRadius = expanded ? ASK_RADIUS_EXPANDED : ASK_RADIUS_PILL;
  const askTransition = {
    type: 'tween' as const,
    duration: reduceMotion === true || !heightMotionReady ? 0 : DIGITAL_TWIN_MOTION.layout,
    ease: DIGITAL_TWIN_EASE_OUT,
  };

  return (
    <motion.div
      className={cn(
        'dt-ask-composer-shadow w-full overflow-visible bg-transparent',
        !fullWidth && 'max-w-[500px]',
      )}
      initial={false}
      animate={{ borderRadius: askRadius }}
      transition={askTransition}
    >
      <motion.form
        ref={formRef}
        onSubmit={handleSubmit}
        initial={false}
        animate={{
          height: composerHeight ?? 'auto',
          borderRadius: askRadius,
        }}
        transition={askTransition}
        className={cn(
          'dt-ask-composer relative flex w-full flex-col overflow-visible bg-background',
          'border border-foreground/10',
        )}
        style={{ overflow: 'visible' }}
      >
        <div className='dt-ask-composer-clip isolate flex h-full min-h-0 w-full flex-col justify-center overflow-hidden'>
          <div ref={shellRef} className='flex w-full shrink-0 flex-col p-1'>
            <label className='sr-only' htmlFor={inputId}>
              Ask your twin anything
            </label>
            <span
              ref={measureRef}
              aria-hidden='true'
              className='pointer-events-none invisible absolute left-0 top-0 whitespace-pre text-sm font-[450] leading-5 tracking-[-0.28px]'
            >
              {value || ' '}
            </span>
            <div
              ref={controlsRef}
              className={cn(
                'grid grid-cols-[28px_minmax(0,1fr)_28px_28px] gap-x-1 gap-y-1.5',
                expanded ? 'items-end' : 'items-center',
              )}
            >
              <div
                className={cn(
                  'justify-self-start',
                  expanded ? 'col-start-1 row-start-2' : 'col-start-1 row-start-1',
                )}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type='button'
                      className={cn(
                        ASK_ICON_CLASS,
                        'bg-foreground/[0.06] hover:bg-foreground/[0.1]',
                      )}
                      aria-label='Add'
                      title='Add'
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin open add menu'
                    >
                      <Plus className='size-4' />
                    </button>
                  </DropdownMenuTrigger>
                  <DigitalTwinComposerPlusMenu
                    extras={extras}
                    onExtrasChange={onExtrasChange}
                    onInsertSnippet={insertSnippet}
                    onUpload={onUpload}
                  />
                </DropdownMenu>
              </div>
              <textarea
                id={inputId}
                ref={inputRef}
                rows={1}
                value={value}
                onChange={event => onValueChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='Ask your twin anything'
                className={cn(
                  ASK_TEXTAREA_CLASS,
                  expanded
                    ? 'col-span-full col-start-1 row-start-1 py-1 leading-5'
                    : 'col-start-2 row-start-1 py-0 leading-7',
                )}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin ask input'
              />
              <ComposerVoiceButton
                onTranscript={text =>
                  onValueChange(current => (current ? `${current.trimEnd()} ${text}` : text))
                }
                className={cn(
                  ASK_ICON_CLASS,
                  'h-7 w-7 opacity-70 hover:bg-foreground/[0.06] hover:opacity-100',
                  expanded ? 'col-start-3 row-start-2' : 'col-start-3 row-start-1',
                )}
              />
              <button
                type='submit'
                disabled={!canSend}
                aria-label='Send'
                title='Send'
                className={cn(
                  ASK_ICON_CLASS,
                  'disabled:cursor-not-allowed',
                  canSend
                    ? 'bg-foreground text-background enabled:hover:opacity-90'
                    : 'bg-foreground/10 text-foreground/40',
                  expanded ? 'col-start-4 row-start-2' : 'col-start-4 row-start-1',
                )}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin ask send'
              >
                <SendPlaneSlant className='size-4' variant='Solid' />
              </button>
            </div>
          </div>
        </div>
      </motion.form>
    </motion.div>
  );
};

const ClawDigitalTwinScreen = (): ReactElement => {
  const statusQuery = useClawDigitalTwinStatus();
  const { data: status, isLoading, backfillStalled } = statusQuery;
  const activity = useClawDigitalTwinPipelineEvents({ limit: 10 }, false, !!status?.enabled);
  const pause = usePauseDigitalTwinBackfill();
  const resume = useResumeDigitalTwinBackfill();
  const navigate = useNavigate();
  const location = useLocation();
  const outlet = useOutlet();
  const { setSelectedAgentSlug } = useSelectedAgent();
  const reduceMotion = useReducedMotion();
  const enabled = !!status?.enabled;
  const [showBackfill, setShowBackfill] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [askValue, setAskValue] = useState('');
  const [askExtras, setAskExtras] = useState<ComposerContext>(EMPTY_COMPOSER_CONTEXT);
  const [originDocked, setOriginDocked] = useState(false);
  const [dockRect, setDockRect] = useState({ left: 16, width: 500 });
  const [chatActive, setChatActive] = useState(false);
  const [sessionOverlay, setSessionOverlay] = useState(false);
  const chatActiveRef = useRef(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [chatConversationId, setChatConversationId] = useState('');
  const [chatSessionKey, setChatSessionKey] = useState('draft');
  const [chatStartFresh, setChatStartFresh] = useState(true);
  const [pendingQuery, setPendingQuery] = useState('');
  const [chatTitleHint, setChatTitleHint] = useState('');
  const [autoSendNonce, setAutoSendNonce] = useState(0);
  const askComposerOriginRef = useRef<HTMLDivElement | null>(null);
  chatActiveRef.current = chatActive;

  useLayoutEffect(() => {
    const origin = askComposerOriginRef.current;
    if (!enabled || !origin) {
      setOriginDocked(false);
      return;
    }

    let syncFrame: number | null = null;

    const syncFloatingComposer = (): void => {
      syncFrame = null;
      const rect = origin.getBoundingClientRect();
      setDockRect(current => {
        const next = { left: rect.left, width: rect.width };
        return current.left === next.left && current.width === next.width ? current : next;
      });
      const nextDocked = rect.bottom <= 0;
      setOriginDocked(current => (current === nextDocked ? current : nextDocked));
    };

    const scheduleSync = (): void => {
      if (syncFrame !== null) return;
      syncFrame = window.requestAnimationFrame(syncFloatingComposer);
    };

    const syncWhenVisible = (): void => {
      if (document.visibilityState === 'visible') scheduleSync();
    };

    let scrollContainer: HTMLElement | Window = window;
    let parent = origin.parentElement;
    while (parent) {
      const { overflowY } = window.getComputedStyle(parent);
      if (/^(auto|scroll|overlay)$/.test(overflowY)) {
        scrollContainer = parent;
        break;
      }
      parent = parent.parentElement;
    }

    syncFloatingComposer();
    const resizeObserver = new ResizeObserver(scheduleSync);
    resizeObserver.observe(origin);
    const intersectionObserver = new IntersectionObserver(scheduleSync);
    intersectionObserver.observe(origin);
    scrollContainer.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync);
    window.addEventListener('pageshow', scheduleSync);
    window.visualViewport?.addEventListener('resize', scheduleSync);
    window.visualViewport?.addEventListener('scroll', scheduleSync);
    document.addEventListener('visibilitychange', syncWhenVisible);

    return (): void => {
      if (syncFrame !== null) window.cancelAnimationFrame(syncFrame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      scrollContainer.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('pageshow', scheduleSync);
      window.visualViewport?.removeEventListener('resize', scheduleSync);
      window.visualViewport?.removeEventListener('scroll', scheduleSync);
      document.removeEventListener('visibilitychange', syncWhenVisible);
    };
  }, [enabled]);

  const openOverlayChat = useCallback(
    (text: string, extras: ComposerContext, fresh: boolean): void => {
      setSelectedAgentSlug(TWIN_AGENT_SLUG);
      setAskExtras(extras);
      setPendingQuery(text);
      setAutoSendNonce(current => current + 1);
      if (fresh) {
        setChatConversationId('');
        setChatSessionKey(
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `draft-${Date.now()}`,
        );
        setChatStartFresh(true);
        setChatTitleHint(text);
      }
      setSessionOverlay(true);
      setChatActive(true);
      setChatExpanded(true);
    },
    [setSelectedAgentSlug],
  );

  const handleAskTwin = useCallback(
    (text: string, extras: ComposerContext): void => {
      openOverlayChat(text, extras, !chatActive);
    },
    [chatActive, openOverlayChat],
  );

  const handleCollapseChat = useCallback((): void => {
    setChatExpanded(false);
  }, []);

  const handleExpandChat = useCallback((): void => {
    setChatExpanded(true);
  }, []);

  const handleCloseChat = useCallback((): void => {
    setChatExpanded(false);
    setChatActive(false);
  }, []);

  const handleSessionExited = useCallback((): void => {
    if (chatActiveRef.current) return;
    setSessionOverlay(false);
    setChatTitleHint('');
    setChatConversationId('');
    setPendingQuery('');
    setChatStartFresh(true);
    setChatSessionKey(
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `draft-${Date.now()}`,
    );
  }, []);

  const handleMaximizeChat = useCallback((): void => {
    setSelectedAgentSlug(TWIN_AGENT_SLUG);
    xyneAIActor.send({
      type: 'OPEN',
      startFreshChat: false,
      ...(chatConversationId ? { focusSessionId: chatConversationId } : {}),
    });
    handleCloseChat();
  }, [chatConversationId, handleCloseChat, setSelectedAgentSlug]);

  const handleSelectConversation = useCallback((id: string | null): void => {
    if (id === null) {
      setChatConversationId('');
      setChatSessionKey(
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `draft-${Date.now()}`,
      );
      setChatStartFresh(true);
      setPendingQuery('');
      setChatTitleHint('');
      setChatExpanded(true);
      return;
    }
    setChatConversationId(id);
    setChatSessionKey(id);
    setChatStartFresh(false);
    setPendingQuery('');
    setChatExpanded(true);
  }, []);

  const running = status?.backfill?.overall.running ?? false;
  const paused = status?.backfill?.overall.paused ?? false;
  const progress = status?.backfill?.overall.pctByWindows ?? null;
  const activePipelineEvent = activity.data?.pages
    .flatMap(page => page.events)
    .find(event => event.status === 'running' || event.status === 'retry');
  const pipelineRunning = !!activePipelineEvent;
  const synthesisRunning = activePipelineEvent?.runType === 'synthesize';
  const backfillSources = Object.entries(status?.backfill?.sources ?? {})
    .filter(([, source]) => !source.complete)
    .map(([source]) => `${source.charAt(0).toUpperCase()}${source.slice(1)}`)
    .join(', ');

  const statusCopy = useMemo(() => {
    if (status?.memoryDeleteInProgress) return 'Cleaning up memories';
    if (synthesisRunning) return 'Refreshing how it represents you';
    if (paused) return 'History import paused';
    if (backfillStalled) return 'History import needs attention';
    if (running) return 'Learning from your history';
    if (pipelineRunning) return 'Learning work is running';
    return 'Ready';
  }, [
    backfillStalled,
    paused,
    pipelineRunning,
    running,
    status?.memoryDeleteInProgress,
    synthesisRunning,
  ]);

  const working =
    running || paused || backfillStalled || pipelineRunning || !!status?.memoryDeleteInProgress;

  const navClassName = ({ isActive }: { isActive: boolean }): string =>
    cn(
      'dt-transition relative isolate flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] px-3 py-1',
      'text-sm font-[450] leading-[1.2]',
      isActive
        ? 'text-foreground'
        : 'text-foreground/80 hover:bg-foreground/[0.04] hover:text-foreground',
    );

  const contentKey =
    isLoading && !status
      ? 'loading'
      : statusQuery.isError && !status
        ? 'error'
        : enabled
          ? location.pathname
          : 'enable';

  return (
    <MotionConfig reducedMotion='user'>
      <div className='digital-twin-ledger relative min-h-full w-full bg-background text-foreground'>
        <a
          href='#digital-twin-content'
          className='sr-only z-[80] rounded-md bg-background px-4 py-2 text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4'
        >
          Skip Digital Twin navigation
        </a>

        <div className='mx-auto flex w-full max-w-[800px] flex-col gap-4 px-4 pb-16 pt-12 sm:px-0'>
          <header className='flex flex-col'>
            <div className='dt-shell-header flex w-full flex-col items-center gap-4'>
              <div
                className='relative size-20 shrink-0 overflow-hidden rounded-full border-[1.5px] border-foreground/10 bg-background'
                aria-hidden='true'
              >
                <img
                  alt=''
                  src={TWIN_PORTRAIT_SRC}
                  className='dt-twin-portrait-image pointer-events-none absolute'
                />
              </div>
              <h1 className='text-center text-[24px] font-[550] not-italic leading-[1.1] tracking-[-0.1px] text-foreground'>
                Your Digital Twin
              </h1>
            </div>
          </header>

          {enabled && (
            <div className='dt-ask-origin -mx-4 px-4 sm:mx-0 sm:px-0'>
              <div className='dt-ask-origin-bar'>
                <div
                  ref={askComposerOriginRef}
                  className='dt-ask-composer-origin w-full max-w-[500px] overflow-visible'
                >
                  <DigitalTwinChatOverlay
                    variant='origin'
                    open={false}
                    sessionActive={false}
                    docked={originDocked && !sessionOverlay}
                    dockRect={dockRect}
                    reduceMotion={reduceMotion}
                    conversationId={chatConversationId}
                    sessionKey={chatSessionKey}
                    startFresh={chatStartFresh}
                    pendingQuery={pendingQuery}
                    titleHint={chatTitleHint}
                    autoSendNonce={autoSendNonce}
                    extras={askExtras}
                    onConversationChange={setChatConversationId}
                    onSelectConversation={handleSelectConversation}
                    onMaximize={handleMaximizeChat}
                    onCollapse={handleCollapseChat}
                    onExpand={handleExpandChat}
                    onClose={handleCloseChat}
                  >
                    <DigitalTwinAskComposer
                      inputId='digital-twin-ask'
                      value={askValue}
                      onValueChange={setAskValue}
                      extras={askExtras}
                      onExtrasChange={setAskExtras}
                      onAsk={handleAskTwin}
                      onUpload={() => setShowUpload(true)}
                    />
                  </DigitalTwinChatOverlay>
                </div>
              </div>
              {sessionOverlay && (
                <DigitalTwinChatOverlay
                  variant='session'
                  open={chatExpanded}
                  sessionActive={chatActive}
                  docked
                  dockRect={dockRect}
                  reduceMotion={reduceMotion}
                  conversationId={chatConversationId}
                  sessionKey={chatSessionKey}
                  startFresh={chatStartFresh}
                  pendingQuery={pendingQuery}
                  titleHint={chatTitleHint}
                  autoSendNonce={autoSendNonce}
                  extras={askExtras}
                  onConversationChange={setChatConversationId}
                  onSelectConversation={handleSelectConversation}
                  onMaximize={handleMaximizeChat}
                  onCollapse={handleCollapseChat}
                  onExpand={handleExpandChat}
                  onClose={handleCloseChat}
                  onExited={handleSessionExited}
                >
                  <DigitalTwinAskComposer
                    inputId='digital-twin-ask-session'
                    value={askValue}
                    onValueChange={setAskValue}
                    extras={askExtras}
                    onExtrasChange={setAskExtras}
                    onAsk={handleAskTwin}
                    onUpload={() => setShowUpload(true)}
                    fullWidth
                  />
                </DigitalTwinChatOverlay>
              )}
            </div>
          )}

          {enabled && (
            <nav className='mt-6 flex items-start gap-1 overflow-x-auto' aria-label='Digital Twin'>
              <NavLink to={`${BASE}/overview`} className={navClassName}>
                {({ isActive }) => <DigitalTwinNavLabel label='Overview' isActive={isActive} />}
              </NavLink>
              <NavLink to={`${BASE}/configuration`} className={navClassName}>
                {({ isActive }) => (
                  <DigitalTwinNavLabel label='Configuration' isActive={isActive} />
                )}
              </NavLink>
              <NavLink to={`${BASE}/memories`} className={navClassName}>
                {({ isActive }) => <DigitalTwinNavLabel label='Memories' isActive={isActive} />}
              </NavLink>
              <NavLink to={`${BASE}/proposals`} className={navClassName}>
                {({ isActive }) => <DigitalTwinNavLabel label='Review' isActive={isActive} />}
              </NavLink>
              <NavLink to={`${BASE}/activity`} className={navClassName}>
                {({ isActive }) => <DigitalTwinNavLabel label='Activity' isActive={isActive} />}
              </NavLink>
            </nav>
          )}

          <AnimatePresence initial={false}>
            {enabled && working && (
              <motion.section
                layout='position'
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: DIGITAL_TWIN_MOTION.state, ease: DIGITAL_TWIN_EASE_OUT }}
                className='flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 p-4'
                aria-live='polite'
                aria-label='Digital Twin background work'
              >
                <div className='min-w-[220px] flex-1'>
                  <div className='flex items-center justify-between gap-4'>
                    <p className='text-sm font-semibold text-foreground'>{statusCopy}</p>
                    {running && progress !== null && !status?.memoryDeleteInProgress && (
                      <span className='text-xs tabular-nums text-muted-foreground'>
                        {Math.round(progress)}%
                      </span>
                    )}
                  </div>
                  {running && !status?.memoryDeleteInProgress && progress !== null && (
                    <div className='mt-2 h-1.5 overflow-hidden rounded-full bg-border'>
                      <div
                        className='dt-progress h-full bg-primary'
                        style={{
                          transform: `scaleX(${Math.max(0, Math.min(100, progress)) / 100})`,
                        }}
                      />
                    </div>
                  )}
                  <p className='mt-1.5 text-xs leading-5 text-muted-foreground'>
                    {status?.memoryDeleteInProgress
                      ? 'You can keep working while cleanup finishes.'
                      : synthesisRunning
                        ? 'Approved memories are being turned into refreshed profile suggestions.'
                        : pipelineRunning && !running
                          ? 'New learning is being checked. Results will appear in recent activity.'
                          : backfillStalled
                            ? `${backfillSources || 'Your history'} has not made progress for two minutes. Resume to try unfinished sources again.`
                            : paused
                              ? `${backfillSources || 'Your history'} is paused. Your place is saved.`
                              : `${backfillSources || 'Your history'} · ${(status?.backfill?.overall.recordsSeen ?? 0).toLocaleString()} records checked · ${(status?.backfill?.overall.candidatesMade ?? 0).toLocaleString()} memories suggested`}
                  </p>
                </div>
                {!status?.memoryDeleteInProgress && (running || paused || backfillStalled) && (
                  <Button
                    variant='outline'
                    size='sm'
                    loading={pause.isPending || resume.isPending}
                    onClick={() => {
                      if (paused || backfillStalled) resume.mutate();
                      else pause.mutate();
                    }}
                    data-track-category='Claw Agents'
                    data-track-name={
                      paused || backfillStalled
                        ? 'Digital Twin resume history import'
                        : 'Digital Twin pause history import'
                    }
                  >
                    {paused || backfillStalled ? (
                      <Play className='size-4' />
                    ) : (
                      <Pause className='size-4' />
                    )}
                    {paused || backfillStalled ? 'Resume' : 'Pause'}
                  </Button>
                )}
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => void navigate(`${BASE}/activity`)}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin view background activity'
                >
                  See progress
                </Button>
              </motion.section>
            )}
          </AnimatePresence>

          <main className='contents'>
            <span id='digital-twin-content' className='sr-only' tabIndex={-1}>
              Digital Twin content
            </span>
            <div id='digital-twin-route-controls' className='contents' />

            <AnimatePresence mode='popLayout' initial={false}>
              <motion.div
                key={contentKey}
                className='dt-route-stage'
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{
                  duration: reduceMotion ? DIGITAL_TWIN_MOTION.feedback : DIGITAL_TWIN_MOTION.route,
                  ease: reduceMotion ? DIGITAL_TWIN_EASE_IN : DIGITAL_TWIN_EASE_OUT,
                }}
              >
                {isLoading && !status ? (
                  <div className='flex flex-col gap-4'>
                    <Skeleton className='h-24 w-full rounded-none' />
                    <Skeleton className='h-72 w-full rounded-none' />
                  </div>
                ) : statusQuery.isError && !status ? (
                  <div
                    role='alert'
                    className='flex min-h-72 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-8 py-12 text-center'
                  >
                    <AlertTriangle className='size-7 text-destructive' />
                    <h2 className='mt-4 text-base font-semibold text-foreground'>
                      Digital Twin status did not load
                    </h2>
                    <p className='mt-1 max-w-[58ch] text-sm text-muted-foreground'>
                      No settings were changed. Check the connection and try again.
                    </p>
                    <Button
                      variant='outline'
                      size='sm'
                      className='mt-4'
                      onClick={() => void statusQuery.refetch()}
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin retry status'
                    >
                      <RefreshCw className='size-4' />
                      Try again
                    </Button>
                  </div>
                ) : enabled ? (
                  outlet
                ) : (
                  <DigitalTwinEnablePanel />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <EnableModal open={showBackfill} mode='backfill' onClose={() => setShowBackfill(false)} />
        <UploadModal open={showUpload} onClose={() => setShowUpload(false)} />
      </div>
    </MotionConfig>
  );
};

export default ClawDigitalTwinScreen;
