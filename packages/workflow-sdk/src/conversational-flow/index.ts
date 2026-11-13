/**
 * Conversational flows: a workflow that talks someone through a process —
 * screens, options, typed text routed by a model, things fetched on the way, and
 * an ending that reports what happened or hands over to a person.
 *
 * Nothing here is a new engine construct. **The config is the tree**: the
 * conversation is a CYCLE, its SWITCH has one case per screen, and a screen with
 * screens inside it is a case holding a CYCLE of its own. So where a case sits is
 * where the screen is, what a section fetched stays in scope for everything
 * inside it, and a jump names the innermost frame holding both its ends.
 *
 * This section reads that shape into screens (`readConversationalFlow`), edits it
 * as pure `config → config` functions, creates new ones, and turns a run of one
 * into what a caller sees (`readTurn`). Everything derived — the subtrees, the
 * frames, the headings, what each router may choose — is written by `settle`
 * after every edit, so an edit only ever says what the author meant.
 */

// ─── Reading a flow ───
export { readConversationalFlow } from './read.js';
export { refreshDerived, ConversationalFlowEditError } from './settle.js';
export type {
  AskAiInfo,
  Call,
  CallScope,
  Condition,
  ConversationalFlow,
  DeclaredField,
  Destination,
  LeafCondition,
  Prompt,
  PromptOption,
  Question,
  QuestionDraft,
  QuestionField,
  RouterInfo,
  Screen,
  ScreenKind,
} from './types.js';
// Read off a declared shape — what an author may quote. Exported because the
// lookup editor has to know which paths are quotable, and two definitions of
// that would drift.
export { declaredFields } from './calls.js';

export {
  AGENT_STEP_TYPE,
  CLASSIFIER_STEP_TYPE,
  DEFAULT_CLASSIFIER_ENDPOINT,
  END_MESSAGE_KEY,
  HTTP_STEP_TYPE,
  optionsOf,
  saysOf,
  waysOn,
} from './types.js';

// ─── What a condition says ───
export { fieldName, group, isFlat, joinOf, labelFor, leavesOf, partsIn, takesValue } from './conditions.js';
export { OPERATOR_DESCRIPTORS, ConditionOperator, type OperatorDescriptor } from '../types/operators.js';

// ─── Where things sit ───
export { ancestorsOf, breadcrumb, childrenOf, mainMenuLabel, outsideMenu, subtreeOf, treeOrder } from './tree.js';
export { screenAtPath } from './paths.js';
export {
  candidatesOf,
  endsByTyping,
  flowRouter,
  frameOf,
  routableScreens,
  routerFor,
  routerName,
  routersFor,
  routersOf,
  routingIsValid,
  scopeOf,
} from './routers.js';

// ─── Making one ───
export { CONVERSATIONAL_FLOW_KIND, createConversationalFlow, type NewConversationalFlow, type NewRouter } from './create.js';

// ─── Editing one ───
export {
  addScreen,
  duplicateScreen,
  emptyScreen,
  insertScreenAbove,
  moveIsValid,
  moveScreen,
  removeScreen,
  renameScreen,
  type Emptying,
  type NewScreen,
} from './edit/screens.js';
export { setScreenType, setAskAi, whatChangingTypeCosts, type NewScreenType } from './edit/kinds.js';
export {
  addOption,
  moveOption,
  relabelOption,
  removeOption,
  retargetOption,
  setOptionCondition,
  setWayBack,
  type NewOption,
} from './edit/options.js';
export { setAbout, setPromptSays, setTypingAllowed } from './edit/prompts.js';
export { addInputScreen, setQuestion, setQuestionPurpose, setQuestionSays } from './edit/questions.js';
// How an answer is quoted, so the editor and the engine spell the same path one way.
export { answerRef } from './questions.js';
export { optionsFrom, setOptionsFromLookup, setOptionsWritten } from './edit/picklist.js';
export { addVersion, removeVersion, setVersionWhen } from './edit/versions.js';
export { setEndMessage, setEndResult } from './edit/endings.js';
export { setConversationInputs, type ConversationInput } from './edit/inputs.js';
export {
  scopeRouter,
  setRouterGuidance,
  setRouterMode,
  setRouterService,
  setTypedRouter,
  type RouterMode,
  type RouterService,
} from './edit/routers.js';
export {
  addCall,
  callRef,
  moveCall,
  quotedIn,
  removeCall,
  setCall,
  setCallFallback,
  type CallDraft,
} from './edit/calls.js';

// ─── Running one ───
export {
  RETRY_AFTER_MS,
  TurnAnswerError,
  answerFor,
  answeredWith,
  readTranscript,
  readTurn,
  streamEventOf,
  type ConversationStreamEvent,
  type RunStepView,
  type RunView,
  type Transcript,
  type TranscriptEntry,
  type Turn,
  type TurnAnswer,
  type TurnEvent,
  type TurnField,
  type TurnHandoff,
  type TurnMessage,
  type TurnOption,
  type TurnReply,
  type TurnScreen,
  type TurnStatus,
} from './turn.js';
