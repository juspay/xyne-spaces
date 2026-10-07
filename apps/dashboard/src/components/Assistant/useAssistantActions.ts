import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { stateMachineActor } from '../../machines/stateMachine';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { getAllChannels } from '../../hooks/useChannels';
import { useStableRouter, type StableRouter } from '../../hooks/useStableRouter';
import { useHasResourceAccess } from '../../hooks/usePermissions';
import { useSelf } from '../../hooks/useUsers';
import { useZeroWithFallback as useZero } from '../../hooks/useZeroWithFallback';
import { useOrganisationsAccess } from '../../routes/OrganisationsModule/organisationsSections';
import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import type { PendingField } from '../../services/assistantRouteService';
import {
  describeLocal,
  describeRoute,
  describeTiming,
  diagnose,
  startRequest,
} from '../Voice/diagnoseLog';
import { voiceSession } from '../Voice/voiceSession';
import { hasValue, type ActionDefinition, type FieldValue } from './actions/action';
import { assistantSession, useAssistantSession, type Run } from './assistantSession';
import { ACTIONS } from './catalog';
import { conversationOf, joinedChannelIds, readDirectory } from './directory';
import { droppedText, nextAfter, type QueuedStep } from './engine/chain';
import {
  advance,
  ALREADY_SENT,
  endsDialogue,
  LIST_GONE,
  openQuestion,
  replyFor,
  startDialogue,
  SOMEONE_ELSE,
  STOPPED,
  TELL_ME_MORE,
  type DialogueEvent,
  type EngineState,
  type ListItem,
  type Step,
} from './engine/dialogue';
import { interpretLocally, interpretRoute, interpretTap, type Decision } from './engine/interpret';
import type { Directory, Resolved } from './engine/resolve';
import { afterList, opening, spokenItem } from './engine/results';
import { runPlan, showProgress } from './engine/runner';
import { begin, isOperable } from './engine/start';
import { sentences } from './engine/text';
import { interpretRead, offerAfterRefusal } from './engine/unsureCard';
import { operableForms } from './forms/operableForm';
import { onScreen, snapshotOf, type PublishedList, type ShownThread } from './onScreen';
import { APP_PAGES, askingPage, firstPage, visibleActions, type PageId } from './pages';
import { routeText } from './router';
import {
  append,
  closeUnsure,
  dropQueue,
  endDialogue,
  newId,
  outcomeOf,
  post,
  readContext,
  resumePrompt,
  setTurns,
  warmPhrases,
} from './sessionTurns';
import { TASKS, type TaskId, type TaskOutcome, type ZeroClient } from './tasks';
import {
  capabilities,
  currentCard,
  markOpened,
  pillAction,
  say,
  starterActions,
  toChatMessages,
  withoutCards,
  type AssistantCardData,
  type CurrentCard,
} from './turns';

export interface AssistantActions {
  actions: readonly ActionDefinition[];
  starters: readonly ActionDefinition[];
  messages: Message[];
  isRouting: boolean;
  choose: (action: ActionDefinition) => void;
  openPill: (messageId: string, label: string) => void;
  reset: () => void;
  cancel: () => void;
  // `tagged`: the people picked as @mention chips in the composer, who are then not searched for.
  ask: (text: string, tagged?: readonly Resolved[]) => Promise<AskOutcome>;
  // The question the assistant put on screen to tap, and the tap. `spoken`: the user is in voice mode.
  card: CurrentCard | null;
  // Whether the tap was taken: one that no longer fits the question on screen is not.
  pick: (optionId: string, spoken?: boolean) => boolean;
  // Voice: the reply to speak, '' when the text was handled with nothing to say, null to send it to Ask AI.
  answer: (text: string) => Promise<string | null>;
  // What voice mode synthesizes ahead of time: the open question and the likeliest replies.
  phrases: () => readonly string[];
  // The open question put again, for voice mode to say after a detour; null when none is open.
  resumePrompt: () => string | null;
}

// `handed_over`: a sentence went to Ask AI from here, so the caller sends nothing.
export type AskOutcome =
  | { outcome: 'replied'; reply: string }
  | { outcome: 'ask_ai' }
  | { outcome: 'handed_over' }
  | { outcome: 'cancelled' };

// What the form of the action holds right now: what the user typed there counts as answered.
const fieldReader = (action: ActionDefinition): ((field: string) => FieldValue) => {
  const form = action.plan.flatMap(step => ('form' in step ? [step.form] : []))[0];
  return field => (form ? operableForms.get(form)?.fields[field]?.get() : null) ?? null;
};

// The question a sentence may be the answer to, for Jev: as it was put to the user.
const pendingOf = (state: EngineState): PendingField | undefined => {
  const question = openQuestion(state);
  return question ? { action: state.action.id, ...question } : undefined;
};

// An item of a list as its card button reads: who or what, where, and when.
const cardItem = (item: ListItem): { id: string; label: string } => ({
  id: item.id,
  label: item.detail ? `${spokenItem(item)} · ${item.detail}` : spokenItem(item),
});

const cardOf = (step: Step): AssistantCardData | undefined => {
  if (step.kind === 'confirm') return { kind: 'confirm', summary: step.summary };
  if (step.kind === 'results' && step.options.length > 0) {
    return { kind: 'choose', options: [...step.options.map(cardItem), TELL_ME_MORE] };
  }
  if (step.kind !== 'choose') return undefined;
  return { kind: 'choose', options: step.more ? [...step.options, SOMEONE_ELSE] : step.options };
};

// How long a run that leaves a list waits for the page to show it, before saying `done` instead.
const LIST_WAIT_MS = 4000;
// How long the router and then the page have to take a run's navigation: a page that still shows
// its list under the same key after it was asked the same search again.
const LIST_KEPT_MS = 1000;

// Resolves once the router has moved from `from`, or after LIST_KEPT_MS when it has not.
const moved = (router: StableRouter, from: unknown): Promise<void> =>
  new Promise(resolve => {
    const done = (): void => {
      stop();
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, LIST_KEPT_MS);
    const stop = router.subscribe(() => {
      if (router.getSnapshot().location !== from) done();
    });
    if (router.getSnapshot().location !== from) done();
  });

// How long the next step of a chain waits for the conversation the step before opened: "it".
const HERE_WAIT_MS = 1000;

// Resolves once a page shows another conversation than `from`, or after HERE_WAIT_MS.
const opened = (from: ShownThread | null): Promise<void> =>
  new Promise(resolve => {
    const done = (): void => {
      stop();
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, HERE_WAIT_MS);
    const stop = onScreen.thread.onOpen(done);
    const shown = onScreen.thread.get();
    if (shown && shown !== from) done();
  });

// What a turn carries besides its event: the request it was switched to from, the steps of its
// sentence still to come, and what the step before it came to.
interface Carried {
  aside?: EngineState;
  queue?: QueuedStep[];
  done?: string;
}

// The next step of a chain, started once the one before it is done.
type Follow = Carried & { state: EngineState; event: DialogueEvent };

// A chain's step follows what was done; steps let go of are said after a request that ended, or
// before the question of the one that replaced them.
const replyOf = (step: Step, done: string | undefined, dropped: string): string => {
  const reply = done ? nextAfter(done, replyFor(step)) : replyFor(step);
  return endsDialogue(step) ? sentences(reply, dropped) : sentences(dropped, reply);
};

const speak = (spoken: boolean, text: string): void => {
  if (spoken && voiceSession.active()) voiceSession.speak(text);
};

// A run's outcome, posted and said on its own: the first reply was already given.
const tell = (text: string, spoken: boolean, card?: AssistantCardData): void => {
  post(null, text, card);
  speak(spoken, text);
};

// Opens an item of the list on screen; false when the page no longer shows it.
const openItem = ({ id }: ListItem): boolean => {
  const list = onScreen.list.get();
  if (!list?.items.some(item => item.id === id)) return false;
  list.open(id);
  return true;
};

// Reading or opening a page is done at once and has nothing to confirm, so its outcome is the
// only reply; changing or sending takes seconds and is answered at first.
const isInstant = (action: ActionDefinition): boolean =>
  action.effect === 'read' || action.effect === 'navigate';

interface AssistantOptions {
  enabled: boolean;
  // 'page' is the /ai screen, which hands the conversation to the side panel when it opens a page.
  surface?: 'page' | 'panel';
  // Sends a sentence to Ask AI as the surface's composer would, when the user picks Ask Xyne AI.
  askAI?: (text: string) => void;
}

export const useAssistantActions = ({
  enabled,
  surface = 'panel',
  askAI,
}: AssistantOptions): AssistantActions => {
  const navigate = useNavigate();
  const router = useStableRouter();
  const zero = useZero();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const organisations = useOrganisationsAccess();
  const actions = useMemo(
    () => (enabled ? visibleActions(ACTIONS, { organisations }) : []),
    [enabled, organisations],
  );
  // Hidden by the user's role: Jev hears of them only so the user can be told they lack access.
  const hidden = useMemo(
    () => (enabled ? ACTIONS.filter(action => !actions.includes(action)) : []),
    [enabled, actions],
  );
  const starters = useMemo(() => starterActions(actions), [actions]);
  const selfId = useSelf()?.id ?? null;
  // As the User Groups page reads it, so Buddy changes only the groups that page lists.
  const userGroupsAdmin = useHasResourceAccess('USER-GROUPS');
  // Read when a name is resolved, not rendered from: following every navigation would re-render
  // the sidebar for nothing.
  const readHere = useCallback(
    (tagged?: readonly Resolved[]): Directory => ({
      ...readDirectory(conversationOf(selfId)),
      selfId,
      ...(tagged && { tagged }),
    }),
    [selfId],
  );
  // The latest render's, as a tap is handled after it.
  const askAIRef = useRef(askAI);
  askAIRef.current = askAI;
  const owner = `${selfId ?? ''}:${workspaceId ?? ''}`;
  useEffect(() => assistantSession.ownedBy(owner), [owner]);
  // Only what is rendered: the rest of the session is read through assistantSession.get().
  const sessionOwner = useAssistantSession(current => current.owner);
  const turns = useAssistantSession(current => current.turns);
  const routing = useAssistantSession(current => current.routing !== null);
  // Until the effect above has run, the session may still be another user's or workspace's.
  const shown = enabled && sessionOwner === owner;
  const messages = useMemo(() => (shown ? toChatMessages(turns) : []), [shown, turns]);

  const goTo = useCallback(
    (page: PageId, params: Record<string, string> = {}): void => {
      const base = workspaceId ? `/${workspaceId}` : '';
      // A page's own query (?mode=dm) stays, and the params are added to it.
      const [path = '', pageQuery] = APP_PAGES[page].path.split('?');
      const search = new URLSearchParams(pageQuery);
      Object.entries(params).forEach(([key, value]) => search.set(key, value));
      const query = search.toString();
      const suffix = query ? `?${query}` : '';
      void navigate(`${base}/${path}${suffix}`);
    },
    [navigate, workspaceId],
  );

  // Opening a page from /ai leaves it, so the side panel carries the conversation on, in voice
  // mode if it was on. The panel is kept closed on /ai, so it opens once this page has gone.
  const handOff = useRef<{ voice: boolean } | null>(null);
  // The run of an instant action, which `answer` waits for: its outcome is the reply.
  const instantRun = useRef<Promise<void> | null>(null);
  useEffect(
    () => (): void => {
      const pending = handOff.current;
      if (!pending) return;
      diagnose('Buddy', `handing over to the side panel${pending.voice ? ', in voice' : ''}`);
      xyneAIActor.send({ type: 'OPEN', startVoiceMode: pending.voice, trackSource: 'assistant' });
    },
    [],
  );

  const openPage = useCallback(
    (page: PageId, params?: Record<string, string>): void => {
      if (surface === 'page') handOff.current = { voice: voiceSession.active() };
      goTo(page, params);
    },
    [surface, goTo],
  );

  // Tasks are done in code; where one leads is a path, not a page of the catalog, but leaving /ai
  // is handed over just the same.
  const perform = useCallback(
    async (task: TaskId, { values, resolved }: EngineState): Promise<TaskOutcome | void> => {
      if (!selfId) throw new Error("I can't tell who you are yet.");
      return TASKS[task]({
        values,
        resolved,
        env: {
          zero: zero as ZeroClient,
          selfId,
          people: stateMachineActor.getSnapshot().context.users,
          channels: getAllChannels(),
          joined: joinedChannelIds(),
          userGroups: stateMachineActor.getSnapshot().context.allUserGroups,
          userGroupsAdmin,
          navigate: path => {
            if (surface === 'page') handOff.current = { voice: voiceSession.active() };
            void router.navigate(path);
          },
          openPage,
        },
      });
    },
    [selfId, surface, zero, router, userGroupsAdmin, openPage],
  );

  // A lone page-only action is opened at once, as its reply says: text alone would leave the
  // user with nothing to act on, least of all by voice. Several are left to pick from. `how`: its
  // steps are said too.
  const show = useCallback(
    (userText: string, chosen: readonly ActionDefinition[], how = false): string => {
      const [only] = chosen;
      const page = chosen.length === 1 && only ? firstPage(only) : undefined;
      if (page) openPage(page);
      const reply = append(userText, chosen, how);
      const dropped = dropQueue();
      if (dropped) post(null, dropped);
      return sentences(reply, dropped);
    },
    [openPage],
  );

  // Runs the plan and tells what it came to; with a step of the sentence still to come, that
  // step is returned to be started, and the outcome is said with its question.
  const execute = useCallback(
    async (state: EngineState, spoken: boolean): Promise<Follow | null> => {
      const startedFor = assistantSession.get().owner;
      const run: Run = { controller: new AbortController(), submitted: false };
      assistantSession.update({ run });
      const seen = onScreen.list.version();
      const before = {
        list: onScreen.list.get(),
        at: router.getSnapshot().location,
        thread: onScreen.thread.get(),
      };
      let told: TaskOutcome | void = undefined;
      const result = await runPlan(
        state,
        openPage,
        async (task, performed) => {
          told = await perform(task, performed);
        },
        run.controller.signal,
        () => {
          run.submitted = true;
        },
      );
      // Still under way while the page fetches the list: what is said next is about it. The same
      // search again leaves the list on screen as it was, under its key, which is then the one
      // meant: at once when the run opened the very URL already open.
      const listFor = async (): Promise<PublishedList | null> => {
        await moved(router, before.at);
        const { pathname, search } = router.getSnapshot().location;
        const same = pathname === before.at.pathname && search === before.at.search;
        const kept = before.list
          ? { key: before.list.key, ms: same ? 0 : LIST_KEPT_MS }
          : undefined;
        return onScreen.list.waitFor(seen, LIST_WAIT_MS, kept);
      };
      const list = result.ok && state.action.outcome === 'list' ? await listFor() : null;
      if (list) diagnose('Buddy list', `${list.items.length} of ${list.total}`);
      if (assistantSession.get().run === run) assistantSession.update({ run: null });
      diagnose('Buddy run', result.ok ? 'done' : `failed ${result.field ?? ''}: ${result.error}`);
      // Another user's or workspace's conversation now: this outcome is not theirs to hear.
      if (assistantSession.get().owner !== startedFor) return null;
      // Reset or replaced while it ran: what was sent is still told, but a run that sent nothing
      // is of no interest any more.
      const current = assistantSession.get().dialogue === state;
      if (!run.submitted && !current) return null;
      // A list is said by how many were found, and waits on the user's pick; one is opened, which
      // ends the request.
      const listed = list && current ? afterList(state, snapshotOf(list)) : null;
      if (listed?.step.kind === 'results' && listed.step.open) list?.open(listed.step.open.id);
      const { queued } = assistantSession.get();
      const [following, ...rest] = queued;
      const chained = result.ok && current && following !== undefined;
      const outcome = listed
        ? { text: replyFor(listed.step), dialogue: endsDialogue(listed.step) ? null : listed.state }
        : outcomeOf(result, state, current, told, chained);
      if (current) assistantSession.update({ dialogue: outcome.dialogue, acted: result.ok });
      if (chained) {
        // "It" in the next step is what this one made, once its page has opened.
        await moved(router, before.at);
        await opened(before.thread);
        // A request made meanwhile let the steps go, and said so.
        if (assistantSession.get().queued !== queued) {
          tell(outcome.text, spoken);
          return null;
        }
        assistantSession.update({ queued: rest });
        const next = begin(following.action, following.fields, readHere(), following.said);
        return { ...next, queue: rest, done: outcome.text };
      }
      // Any other outcome of the request in hand lets the steps still to come go.
      const dropped = current && !result.ok ? dropQueue() : '';
      // Refused for a reason another action of the user's deals with: that is offered on a card.
      const offer =
        !result.ok && result.refused && current
          ? offerAfterRefusal(state, result.error, actions)
          : null;
      // Done while another request waits aside: how to go back to it is said.
      const { aside } = assistantSession.get();
      const back =
        result.ok && !listed && aside ? ` Say continue to go back to ${aside.action.title}.` : '';
      const text = sentences(offer ? offer.text : `${outcome.text}${back}`, dropped);
      if (offer) assistantSession.update({ unsure: offer.unsure });
      const card: AssistantCardData | undefined = listed
        ? cardOf(listed.step)
        : offer
          ? { kind: 'choose', options: offer.options }
          : undefined;
      tell(text, spoken, card);
      return null;
    },
    [openPage, perform, router, actions, readHere],
  );

  // One turn of a dialogue: advance it, show the step as the reply, and start the run when ready.
  const turn = useCallback(
    (
      state: EngineState,
      event: DialogueEvent,
      said: string | null,
      spoken: boolean,
      { aside, queue, done }: Carried = {},
    ): string => {
      const { state: next, step } = advance(state, event, fieldReader(state.action));
      diagnose(
        'Buddy step',
        `${event.type} → ${step.kind}${'field' in step ? ` ${step.field}` : ''}`,
      );
      // A pick from a list the page no longer shows: said so, and the list is let go.
      if (step.kind === 'results' && step.open && !openItem(step.open)) {
        assistantSession.update({ dialogue: null, aside: null });
        post(said, LIST_GONE);
        return LIST_GONE;
      }
      if (event.type === 'fields') {
        Object.entries(event.resolutions ?? {}).forEach(([field, resolution]) =>
          diagnose('Buddy resolve', `${field}: ${JSON.stringify(resolution)}`),
        );
      }
      // A request just started, or switched to: its page is opened while Buddy asks.
      const starting = assistantSession.get().dialogue?.action.id !== next.action.id;
      const ends = endsDialogue(step);
      const { aside: held, queued: before } = assistantSession.get();
      // A request that ends, or another that starts, lets go of the steps that were to follow.
      const queued = queue ?? (starting || ends ? [] : before);
      // The request is the one in hand again, so whatever was put on hold is let go; but one
      // switched to from a card keeps the request it replaced aside, for "continue".
      assistantSession.update({
        dialogue: ends ? null : next,
        aside: aside ?? (starting ? null : held),
        queued,
        acted: step.kind === 'results' && !!step.open,
      });
      const instant = step.kind === 'run' && isInstant(next.action);
      const dropped = queued === before ? '' : droppedText(before);
      // An instant action says only its outcome, once it is done.
      const reply = instant ? dropped : replyOf(step, done, dropped);
      if (reply) post(said, reply, cardOf(step));
      else setTurns(prev => [...withoutCards(prev), ...(said ? [say('user', said, newId)] : [])]);
      // The page the request is done on is opened as it starts, while Buddy asks. A form's preview
      // below opens its page itself, only when it is not open yet.
      const page = askingPage(next.action);
      const asking = step.kind === 'ask' || step.kind === 'choose' || step.kind === 'confirm';
      const previews = next.action.plan.some(({ op }) => op === 'fill');
      if (page && starting && asking && !previews) openPage(page);
      if (step.kind === 'run') {
        const running = execute(next, spoken).then(follow => {
          if (follow) speak(spoken, turn(follow.state, follow.event, null, spoken, follow));
        });
        if (instant) instantRun.current = running;
      }
      // The question did not get through: the form is left open, filled as far as it got.
      else if (step.kind === 'left_open') void showProgress(next.action, next.values, openPage);
      // While collecting, the page is open from the first question and fills as the user answers,
      // so they watch it build up: "create a user" opens the invitations at once.
      else if (asking) {
        // Another turn, or a cancel, ends the fill: the request in hand is no longer this one.
        const stopped = (): boolean => assistantSession.get().dialogue !== next;
        // Words still being chosen between are not a value yet, so they are not filled in.
        const shown = step.kind === 'choose' ? { ...next.values, [step.field]: null } : next.values;
        void showProgress(next.action, shown, openPage, stopped).then(() => {
          // The page may store a value differently ("dev-ops" as "dev ops"): the card shows and
          // confirms what the page holds, so "yes" never runs anything other than what is shown.
          if (step.kind !== 'confirm' || assistantSession.get().dialogue !== next) return;
          const read = fieldReader(next.action);
          const changed = Object.keys(next.action.fields).some(
            field => hasValue(read(field)) && read(field) !== next.values[field],
          );
          if (changed) turn(next, { type: 'fields', values: {} }, null, false);
        });
      }
      return reply;
    },
    [execute, openPage],
  );

  // The conversation is shared, so only the instance that shows it may abort or clear it.
  const cancel = useCallback((): void => {
    if (enabled) assistantSession.get().routing?.abort();
  }, [enabled]);

  const choose = useCallback(
    (action: ActionDefinition): void => {
      // A tap is surer than text still being routed: that gives way to it.
      cancel();
      const spoken = voiceSession.active();
      let reply: string;
      if (isOperable(action)) {
        reply = turn(startDialogue(action), { type: 'fields', values: {} }, action.title, spoken);
      } else {
        endDialogue();
        reply = show(action.title, [action]);
      }
      if (spoken) voiceSession.speak(reply);
    },
    [cancel, turn, show],
  );

  // A pill of an action with something to do starts it, as its starter card would; one that only
  // opens a page opens it, and is ticked.
  const openPill = useCallback(
    (messageId: string, label: string): void => {
      const action = pillAction(assistantSession.get().turns, messageId, label);
      if (action && isOperable(action)) {
        choose(action);
        return;
      }
      const page = action && firstPage(action);
      if (!action || !page) return;
      goTo(page);
      setTurns(prev => markOpened(prev, messageId, action.id));
    },
    [choose, goTo],
  );

  // Does what was decided about a sentence, or a tap when `said` is null; says what to answer.
  const apply = useCallback(
    (decision: Decision, said: string | null, spoken: boolean): AskOutcome => {
      const replied = (reply: string): AskOutcome => ({ outcome: 'replied', reply });
      // The "did you mean" card is answered by whatever comes next, unless that changes nothing.
      if (decision.kind === 'unsure') assistantSession.update({ unsure: decision.unsure });
      else if (decision.kind !== 'wait' && decision.kind !== 'busy') closeUnsure();
      switch (decision.kind) {
        case 'event':
          return replied(turn(decision.state, decision.event, said, spoken, decision));
        // Read again before it is applied (see `reread`), so never here.
        case 'read':
          return { outcome: 'cancelled' };
        case 'say':
        case 'no_access':
          post(said, decision.text);
          return replied(decision.text);
        case 'wait': {
          // The question is asked as before, so its card is put back with the reply.
          post(said, decision.text, assistantSession.get().turns.at(-1)?.card);
          return replied(decision.text);
        }
        case 'busy': {
          const reply = replyFor({ kind: 'busy' });
          post(said, reply);
          return replied(reply);
        }
        case 'open': {
          const opened = openItem(decision.item);
          const reply = opened ? replyFor(opening(decision.item)) : LIST_GONE;
          assistantSession.update({ acted: opened });
          post(said, reply);
          return replied(reply);
        }
        case 'cancel_run': {
          // A run that sent nothing is stopped and forgotten; one that did cannot be undone, and
          // its outcome is still announced.
          const stopped = assistantSession.stopRun();
          if (stopped) endDialogue();
          const reply = sentences(stopped ? STOPPED : ALREADY_SENT, dropQueue());
          post(said, reply);
          return replied(reply);
        }
        case 'show': {
          endDialogue();
          const userText = said ?? decision.actions.map(action => action.title).join(', ');
          return replied(show(userText, decision.actions, decision.how));
        }
        case 'list_actions': {
          // The request under way is left as it is: its question is put again, its card kept.
          const listed = capabilities(actions, resumePrompt());
          post(said, listed.text, assistantSession.get().turns.at(-1)?.card, listed.actions);
          return replied(listed.text);
        }
        case 'unsure':
          post(said, decision.question, { kind: 'choose', options: decision.options });
          return replied(decision.question);
        case 'missed':
          diagnose('Buddy', 'off topic, question kept');
          assistantSession.update({ dialogue: decision.state });
          return { outcome: 'ask_ai' };
        case 'hold': {
          diagnose('Buddy', 'off topic again, request put on hold');
          const { dialogue } = assistantSession.get();
          assistantSession.update({ aside: dialogue, dialogue: null });
          const text = sentences(decision.text, dropQueue());
          post(null, text);
          // Only Ask AI's answer is spoken after this, so the hold is said first: the speech
          // queue keeps it ahead of the streamed reply.
          speak(spoken, text);
          return { outcome: 'ask_ai' };
        }
        case 'ask_ai': {
          const { text } = decision;
          if (!text) return { outcome: 'ask_ai' };
          // Ask Xyne AI, picked on Buddy's card: the sentence the card was about is what it gets.
          if (spoken && voiceSession.active()) voiceSession.askAI(text);
          else askAIRef.current?.(text);
          return { outcome: 'handed_over' };
        }
      }
    },
    [turn, show, actions],
  );

  // The card's pick of an action for a sentence Jev read no field from: the sentence is read again
  // for that action alone, with the card's question pending. One more call, on this path only.
  // Null when something newer took its place.
  const reread = useCallback(
    async (decision: Decision): Promise<Decision | null> => {
      if (decision.kind !== 'read') return decision;
      const { action, said, question } = decision;
      const controller = new AbortController();
      assistantSession.update({ routing: controller });
      try {
        const { route } = await routeText(said, [action], [], controller.signal, {
          action: action.id,
          prompt: question,
        });
        if (controller.signal.aborted) return null;
        diagnose('Buddy reread', describeRoute(route));
        return interpretRead(decision, route, readHere());
      } catch (error) {
        diagnose('Buddy reread', `failed: ${String(error)}`);
        return interpretRead(decision, { kind: 'unavailable' }, readHere());
      } finally {
        if (assistantSession.get().routing === controller) {
          assistantSession.update({ routing: null });
        }
      }
    },
    [readHere],
  );

  const pick = useCallback(
    (optionId: string, spoken = false): boolean => {
      const decision = interpretTap(readContext(), optionId, readHere());
      if (!decision) return false;
      // A tap is surer than text still being routed: that gives way to it.
      assistantSession.get().routing?.abort();
      const done = (decided: Decision | null): void => {
        if (!decided) return;
        const outcome = apply(decided, null, spoken);
        if (spoken && outcome.outcome === 'replied' && voiceSession.active()) {
          voiceSession.speak(outcome.reply);
        }
      };
      if (decision.kind === 'read') void reread(decision).then(done);
      else done(decision);
      return true;
    },
    [apply, readHere, reread],
  );
  const reset = useCallback((): void => {
    if (!enabled) return;
    cancel();
    assistantSession.stopRun();
    assistantSession.update({
      turns: [],
      dialogue: null,
      aside: null,
      queued: [],
      unsure: null,
      acted: false,
    });
  }, [enabled, cancel]);

  useEffect(() => cancel, [cancel]);

  // A pick from a list ends when a conversation opens, from Buddy's card or with a click on the
  // page, since what is open is what the next request is about; or when the list leaves the screen,
  // since there is nothing left to pick from.
  useEffect(() => {
    if (!enabled) return undefined;
    const endPick = (): void => {
      if (assistantSession.get().dialogue?.phase.kind === 'results') endDialogue();
    };
    const stopOpen = onScreen.thread.onOpen(endPick);
    const stopGone = onScreen.list.onGone(endPick);
    return (): void => {
      stopOpen();
      stopGone();
    };
  }, [enabled]);

  const converse = useCallback(
    async (text: string, spoken: boolean, tagged?: readonly Resolved[]): Promise<AskOutcome> => {
      // The latest input wins: what is still being routed is given up.
      cancel();
      const said = text.trim();
      // In voice mode, or just after Buddy did something, the user is still working with it.
      const { acted } = assistantSession.get();
      if (acted) assistantSession.update({ acted: false });
      const context = { ...readContext(), ...((spoken || acted) && { engaged: actions }) };
      const directory = readHere(tagged);
      if (!spoken) startRequest();
      diagnose(
        'Buddy heard',
        `“${said}”${context.dialogue ? ` (open: ${context.dialogue.action.id})` : ''}`,
      );
      const local = interpretLocally(context, said, directory);
      if (local) {
        diagnose('Buddy local', describeLocal(local));
        const decided = await reread(local);
        return decided ? apply(decided, said, spoken) : { outcome: 'cancelled' };
      }

      const controller = new AbortController();
      assistantSession.update({ routing: controller });
      try {
        const { route, timing } = await routeText(
          said,
          actions,
          hidden,
          controller.signal,
          context.dialogue ? pendingOf(context.dialogue) : undefined,
        );
        if (controller.signal.aborted) return { outcome: 'cancelled' };
        diagnose('Buddy route', `${describeRoute(route)}${describeTiming(timing)}`);
        return apply(interpretRoute(context, said, route, directory), said, spoken);
      } catch (error) {
        diagnose('Buddy route', `failed: ${String(error)}`);
        return { outcome: 'ask_ai' };
      } finally {
        if (assistantSession.get().routing === controller) {
          assistantSession.update({ routing: null });
        }
      }
    },
    [actions, hidden, cancel, apply, readHere, reread],
  );

  const ask = useCallback(
    (text: string, tagged?: readonly Resolved[]): Promise<AskOutcome> =>
      converse(text, false, tagged),
    [converse],
  );

  const answer = useCallback(
    async (text: string): Promise<string | null> => {
      const result = await converse(text, true);
      if (result.outcome === 'replied') {
        // An instant action says its outcome itself, once it is done; voice stays busy until then.
        await instantRun.current;
        return result.reply;
      }
      return result.outcome === 'ask_ai' ? null : '';
    },
    [converse],
  );

  const card = useMemo(() => (shown ? currentCard(turns) : null), [shown, turns]);

  return {
    actions,
    starters,
    messages,
    isRouting: shown && routing,
    choose,
    openPill,
    reset,
    cancel,
    ask,
    card,
    pick,
    answer,
    phrases: warmPhrases,
    resumePrompt,
  };
};
