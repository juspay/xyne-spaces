/**
 * Everything about the selected screen.
 *
 * Ordered by what a visit is for: what the screen says and offers is at the top,
 * open, because that is what nearly every visit changes. Everything else is a
 * settings row that states what it is set to — readable at a glance, opened only
 * to change it.
 */
import { useState, type ReactNode } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import {
  ancestorsOf,
  breadcrumb,
  type ConversationalFlow,
  emptyScreen,
  type Emptying,
  moveIsValid,
  moveScreen,
  type NewScreenType,
  optionsOf,
  removeScreen,
  renameScreen,
  routersOf,
  routingIsValid,
  scopeRouter,
  type Screen,
  setAbout,
  setScreenType,
  whatChangingTypeCosts,
  setTypingAllowed,
  setWayBack,
} from '@xyne/workflow-sdk/conversational-flow';
import { Button, CommitTextarea, type Edit, KIND, KindTag, ScreenPicker, SectionHead, TypeChoice } from '../ui.js';
import { ContentsDialog } from './ContentsDialog.js';
import { PanelShell } from './PanelShell.js';
import { Asked, canAsk } from './Asked.js';
import { Asking } from './Asking.js';
import { ScreenData, StartedWith } from './DataSections.js';
import { SettingRow, SettingsGroup, SettingsList, SwitchRow } from './Settings.js';
import {
  AskAiSettings,
  EndResult,
  HandoffNote,
  RouterSettings,
  Section,
  sectionKeepsTyping,
  TypedRouting,
  typedRoutingValue,
} from './sections.js';

export interface InspectorProps {
  flow: ConversationalFlow;
  screen: Screen;
  edit: Edit;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onNewScreen: (parent: string, args: { title: string; type: NewScreenType }) => void;
  onOpenSteps?: (() => void) | undefined;
}

export function Inspector({ flow, screen, edit, readOnly, onSelect, onClose, onNewScreen, onOpenSteps }: InspectorProps) {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  const trail = [...ancestorsOf(flow, screen.id)].reverse().map((id) => byId.get(id)!).filter(Boolean);
  const isRoot = screen.id === flow.rootScreen;
  const asks = screen.kind === 'menu' || screen.kind === 'message';
  // What offers options, so it has ways back to fold away and ways on to draw.
  const hasOptions = asks || screen.kind === 'input';
  // What the router may open. An input screen is one: whoever it drops there is
  // asked on the way in, which is the whole point of asking there.
  const routable = hasOptions || screen.kind === 'ask-ai' || screen.kind === 'handoff' || screen.kind === 'end';
  // An input screen and a router are added rather than converted.
  const typeable = screen.kind !== 'router' && screen.kind !== 'custom' && screen.kind !== 'input';
  const newScreen = (args: { title: string; type: NewScreenType }) => onNewScreen(screen.id, args);
  const hasWayBack = optionsOf(screen).some((o) => o.back);
  const canType = screen.prompts.some((p) => p.textField !== undefined);
  const hasRouter = routersOf(flow).length > 0;
  const routableWays = routersOf(flow).filter((r) => routingIsValid(flow, screen.id, r.id)).length;
  const keepsTyping = sectionKeepsTyping(flow, screen);
  const lookups = screen.calls;
  // Somewhere else it could go. The SDK decides what counts, so the list and the
  // move cannot disagree; with nowhere to go there is no choice to offer.
  const elsewhere = flow.screens.filter((s) => s.id !== screen.parent && moveIsValid(flow, screen.id, s.id));

  // A question the author has to answer before an edit can go through: what
  // becomes of what is inside a screen that is about to stop holding any.
  const [asking, setAsking] = useState<{ because: string; confirmLabel: string; run: (where: Emptying) => void } | null>(
    null,
  );

  const changeType = (type: NewScreenType) => {
    // A Menu is the only kind with room beneath it. Rather than refuse the
    // conversion, ask where its contents should go — except on the first
    // screen, whose contents are the conversation and have no outside to go to.
    if (screen.children.length > 0 && type !== 'menu' && !isRoot) {
      setAsking({
        because: `A ${KIND[type].label} can’t hold screens.${type === 'handoff' ? ' A hand off also replaces what this screen says.' : ''}`,
        confirmLabel: `Change to ${KIND[type].label}`,
        run: (where) => {
          edit((c) => setScreenType(emptyScreen(c, screen.id, where), screen.id, type));
        },
      });
      return;
    }
    // Ask about whatever the conversion would actually take away — the SDK says
    // what that is, so the question can't drift from what the edit does.
    const costs = whatChangingTypeCosts(flow, screen.id, type);
    if (costs.length > 0) {
      const said = costs.length === 1 ? costs[0]! : `${costs.slice(0, -1).join(', ')} and ${costs.at(-1)!}`;
      if (!window.confirm(`Change “${screen.title}” to ${KIND[type].label}? This drops ${said}.`)) return;
    }
    edit((c) => setScreenType(c, screen.id, type));
  };

  return (
    <PanelShell
      label={`Screen: ${screen.title}`}
      trail={trail}
      trailFallback={isRoot ? 'First screen' : screen.kind === 'router' ? 'Runs whenever someone types' : 'Not reached from the menu'}
      title={screen.title}
      titleLabel="Screen title"
      onRename={(title) => edit((c) => renameScreen(c, screen.id, title))}
      badge={<KindTag kind={screen.kind} />}
      id={screen.id}
      readOnly={readOnly}
      onSelect={onSelect}
      onClose={onClose}
    >
      {/* What the screen does — open, because this is what a visit is for. */}
      {asks && screen.prompts[0] && (
        <Asking flow={flow} screen={screen} edit={edit} readOnly={readOnly} onSelect={onSelect} onNewScreen={newScreen} />
      )}
      {/* An input screen's whole panel: asking is what it is for. */}
      <Asked flow={flow} screen={screen} edit={edit} readOnly={readOnly} onSelect={onSelect} n="01" />
      {screen.kind === 'ask-ai' && screen.askAi && <AskAiSettings screen={screen} edit={edit} readOnly={readOnly} />}
      {screen.kind === 'end' && <EndResult flow={flow} screen={screen} edit={edit} readOnly={readOnly} />}
      {screen.kind === 'handoff' && <HandoffNote flow={flow} screen={screen} edit={edit} readOnly={readOnly} />}
      {screen.kind === 'router' && screen.router && (
        <RouterSettings flow={flow} screen={screen} edit={edit} readOnly={readOnly} onSelect={onSelect} />
      )}
      {screen.kind === 'custom' && (
        <Section>
          <p className="text-[13px] leading-relaxed text-[var(--wui-fg)]">This screen runs steps the map doesn’t draw.</p>
          {onOpenSteps && (
            <Button variant="secondary" className="self-start" onClick={onOpenSteps}>
              Open as steps <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </Section>
      )}

      {screen.kind !== 'router' && (
        <SettingsList>
          <div className="px-5 pb-3 pt-5">
            <SectionHead n={asks && screen.prompts[0] && screen.versions.length <= 1 ? '03' : canAsk(screen) ? '02' : '01'}>
              Behaviour
            </SectionHead>
          </div>
          {/* The conversation's own settings, on the screen it begins at — and
              first, because they are what everything below can already use. */}
          {isRoot && (
            <SettingsGroup label="Before the conversation starts">
              <SettingRow
                label="Started with"
                value={flow.inputs.length > 0 ? flow.inputs.map((i) => i.path).join(', ') : 'Nothing'}
              >
                <StartedWith flow={flow} edit={edit} readOnly={readOnly} />
              </SettingRow>
              <SettingRow
                label="Fetched once"
                value={lookups.length > 0 ? lookups.map((c) => c.title).join(', ') : 'Nothing'}
              >
                <ScreenData flow={flow} screen={screen} edit={edit} readOnly={readOnly} onSelect={onSelect} />
              </SettingRow>
            </SettingsGroup>
          )}

          <Maybe when={isRoot} label="This screen">
            {typeable && !readOnly && (
              <SettingRow label="Screen type" value={KIND[screen.kind].label}>
                <TypeChoice
                  value={screen.kind === 'menu' || screen.kind === 'message' ? screen.kind : (screen.kind as NewScreenType)}
                  onChange={changeType}
                />
                <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">{KIND[screen.kind].hint}</p>
              </SettingRow>
            )}

            {/* Where it sits — the one row here that changes more than its own
                screen, so it says what else comes along. */}
            {!isRoot && !readOnly && elsewhere.length > 0 && (
              <SettingRow
                label="Inside"
                value={screen.parent ? (byId.get(screen.parent)?.title ?? screen.parent) : 'Nothing leads here'}
                attention={!screen.parent}
              >
                <label htmlFor={`inside-${screen.id}`} className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">
                  {screen.children.length > 0
                    ? `Everything inside “${screen.title}” moves with it, and the ways back are re-aimed at wherever it lands.`
                    : 'Its ways back are re-aimed at wherever it lands.'}
                </label>
                <ScreenPicker
                  id={`inside-${screen.id}`}
                  aria-label="Inside"
                  flow={flow}
                  value={screen.parent ?? ''}
                  {...(screen.parent ? {} : { placeholder: 'Choose a screen…' })}
                  only={(s) => moveIsValid(flow, screen.id, s.id)}
                  onChange={(parentId) => edit((c) => moveScreen(c, screen.id, parentId))}
                />
              </SettingRow>
            )}

            {routable && (
              <SettingRow
                label="Found by the router"
                value={screen.about ? screen.about : hasRouter ? 'Not described' : 'No router in this flow'}
                attention={hasRouter && !screen.about}
              >
                <label htmlFor={`about-${screen.id}`} className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">
                  What someone might say, in their own words, that should open this screen.
                </label>
                <CommitTextarea
                  id={`about-${screen.id}`}
                  aria-label="Found by the router"
                  value={screen.about ?? ''}
                  rows={2}
                  disabled={readOnly}
                  placeholder="e.g. they can’t sign in or forgot their password"
                  onCommit={(about) => edit((c) => setAbout(c, screen.id, about))}
                />
                {!screen.about && (
                  <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
                    {screen.kind === 'end'
                      ? 'Left empty, typing can never end the conversation here — only tapping can.'
                      : 'Without this, the router only knows the screen by its place in the menu.'}
                  </p>
                )}
              </SettingRow>
            )}

            {/* Routed typing is a thing a Menu or a Message does with a typed
                message. A screen that asks for something takes typing because
                it asked for it, and sends it nowhere. */}
            {asks && !readOnly && (
              <SwitchRow
                label="Let them type"
                hint={canType ? 'A typed message is read by the AI router' : 'They can only choose an option here'}
                checked={canType}
                onChange={(on) => edit((c) => setTypingAllowed(c, screen.id, on))}
              />
            )}

            {/* A section can hold typed messages inside it. One thing, so one switch. */}
            {canType && !readOnly && keepsTyping !== undefined && (
              <SwitchRow
                label="Keep typed messages in this section"
                hint={
                  keepsTyping
                    ? `Typing under “${screen.title}” only opens screens beneath it, the first screen, or a hand off.`
                    : `Typing under “${screen.title}” can open any screen in the flow.`
                }
                checked={keepsTyping}
                onChange={(on) => edit((c) => scopeRouter(c, screen.id, on))}
              />
            )}

            {/* Only when there is a choice to make: one place is not a choice. */}
            {canType && !readOnly && routableWays > 1 && (
              <SettingRow label="Typed messages look in" value={typedRoutingValue(flow, screen) ?? 'the router'}>
                <TypedRouting flow={flow} screen={screen} edit={edit} readOnly={readOnly} />
              </SettingRow>
            )}

            {hasOptions && !isRoot && !readOnly && (
              <SwitchRow
                label="Offer the way back"
                hint="↑ each screen above it, and the first screen"
                checked={hasWayBack}
                onChange={(on) => edit((c) => setWayBack(c, screen.id, on))}
              />
            )}

            {!isRoot && (lookups.length > 0 || !readOnly) && (
              <SettingRow
                label={screen.children.length > 0 ? 'Fetched for everything in here' : 'Fetched before this screen'}
                value={lookups.length > 0 ? lookups.map((c) => c.title).join(', ') : 'Nothing'}
              >
                <ScreenData flow={flow} screen={screen} edit={edit} readOnly={readOnly} onSelect={onSelect} />
              </SettingRow>
            )}

          </Maybe>
        </SettingsList>
      )}

      {!readOnly && !isRoot && screen.kind !== 'router' && (
        <Section>
          <Button
            variant="danger"
            className="self-start"
            onClick={() => {
              if (screen.children.length > 0) {
                setAsking({
                  because: 'Removing it would take them with it.',
                  confirmLabel: 'Remove screen',
                  run: (where) => {
                    if (edit((c) => removeScreen(emptyScreen(c, screen.id, where), screen.id))) {
                      onSelect(screen.parent ?? flow.rootScreen);
                    }
                  },
                });
                return;
              }
              if (!window.confirm(`Remove “${breadcrumb(flow, screen) || screen.title}”? Options that lead here are removed too.`)) return;
              if (edit((c) => removeScreen(c, screen.id))) onSelect(screen.parent ?? flow.rootScreen);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove screen
          </Button>
        </Section>
      )}

      {asking && (
        <ContentsDialog
          flow={flow}
          screen={screen}
          because={asking.because}
          confirmLabel={asking.confirmLabel}
          onCancel={() => { setAsking(null); }}
          onChoose={(where) => { setAsking(null); asking.run(where); }}
        />
      )}
    </PanelShell>
  );
}

/** Rows under a heading when the panel is about two things, bare when it isn't. */
function Maybe({ when, label, children }: { when: boolean; label: string; children: ReactNode }) {
  return when ? <SettingsGroup label={label}>{children}</SettingsGroup> : <>{children}</>;
}
