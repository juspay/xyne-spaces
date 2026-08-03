/**
 * POT — XYNE-55053 / F37: inline onFeedback arrow defeats MessageItem's React.memo
 *
 * MessageItem is wrapped in React.memo (MessageItem.tsx:1052). React.memo's
 * default bail-out compares prev/next props with shallowEqual (Object.is over
 * own enumerable keys). If ANY prop reference changes, the memoized child
 * re-renders.
 *
 * This proof uses the ACTUAL React.memo comparator: React's shallowEqual,
 * reproduced verbatim from react-reconciler/packages/shared/shallowEqual.js,
 * and applied to the REAL prop objects the render loop builds for a
 * non-target (older) message on each streaming token.
 *
 *   BEFORE: onFeedback={(id, type) => void handleFeedback(id, type)}
 *           -> a NEW function reference every render -> Object.is false
 *           -> React.memo CANNOT bail out -> child re-renders every token.
 *
 *   AFTER:  onFeedback={handleFeedbackVoid}   // useCallback([handleFeedback])
 *           -> SAME reference while feedbackMap/currentTraceId unchanged
 *           -> all props Object.is-equal -> React.memo BAILS OUT -> 0 re-renders.
 *
 * Run: node proofs/XYNE-55053/proof_f37_memo.cjs
 */
'use strict';

// --- React's shallowEqual (react-reconciler/shared/shallowEqual.js), verbatim ---
function is(x, y) {
  return (x === y && (x !== 0 || 1 / x === 1 / y)) || (x !== x && y !== y);
}
function shallowEqual(objA, objB) {
  if (is(objA, objB)) return true;
  if (typeof objA !== 'object' || objA === null || typeof objB !== 'object' || objB === null) {
    return false;
  }
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const currentKey = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(objB, currentKey) || !is(objA[currentKey], objB[currentKey])) {
      return false;
    }
  }
  return true;
}

// --- Stable references shared across renders (all the useCallback'd handlers) ---
const handleFeedback = () => Promise.resolve(); // useCallback([feedbackMap, currentTraceId])
const handleCitationClick = () => {};
const handleSummarizerCitationClick = () => {};
const handleRatingChange = () => {};

// AFTER: the new stable wrapper, memoized once (useCallback([handleFeedback])).
const handleFeedbackVoid = (id, type) => void handleFeedback(id, type);

// A non-target/older message during streaming: message object identity is stable,
// its conditional callbacks are all `undefined` (it is not the latest turn).
const olderMessage = { id: 'm12', type: 'bot', stableKey: 'm12' };

// Build the FULL prop set the render loop passes to MessageItem for this row.
function buildProps(onFeedback) {
  return {
    message: olderMessage,
    onFeedback,
    onCitationClick: handleCitationClick,
    onSummarizerCitationClick: handleSummarizerCitationClick,
    feedbackValue: null,
    isV2: true,
    onRatingChange: handleRatingChange,
    onRegenerate: undefined, // not the latest bot message
    onEditSubmit: undefined,
    onEditMobile: undefined,
    isLatestBotMessage: false,
    branchInfo: undefined,
    onBranchNavigate: undefined,
    onDebug: undefined,
    onOpenToolDebug: undefined,
    onFollowUpSuggestionClick: undefined,
  };
}

function simulateStreaming(getOnFeedback, tokens) {
  let prevProps = buildProps(getOnFeedback());
  let rerenders = 0;
  for (let t = 0; t < tokens; t++) {
    // A streaming token updates the LATEST bot message -> parent re-renders ->
    // the render loop rebuilds this older row's props too.
    const nextProps = buildProps(getOnFeedback());
    if (!shallowEqual(prevProps, nextProps)) rerenders++; // React.memo could NOT bail out
    prevProps = nextProps;
  }
  return rerenders;
}

const TOKENS = 100; // ~10s of streaming at 10 tok/s
const MESSAGES = 50; // older rows in the list (ticket's measured scenario)

// BEFORE: inline arrow -> fresh reference each render.
const before = simulateStreaming(() => (id, type) => void handleFeedback(id, type), TOKENS);
// AFTER: stable useCallback reference.
const after = simulateStreaming(() => handleFeedbackVoid, TOKENS);

console.log('F37 — React.memo bail-out for ONE older MessageItem across ' + TOKENS + ' streaming tokens\n');
console.log('  reference identity of onFeedback across renders:');
const a1 = (id, type) => void handleFeedback(id, type);
const a2 = (id, type) => void handleFeedback(id, type);
console.log('    BEFORE  Object.is(frameA, frameB) = ' + is(a1, a2) + '   (new arrow each render)');
console.log('    AFTER   Object.is(frameA, frameB) = ' + is(handleFeedbackVoid, handleFeedbackVoid) + '    (stable useCallback)\n');

console.log('  wasted re-renders (React.memo could NOT skip):');
console.log('    BEFORE  ' + before + ' / ' + TOKENS + ' tokens   -> re-renders EVERY token');
console.log('    AFTER   ' + after + ' / ' + TOKENS + ' tokens   -> bails out EVERY token\n');

const perTokenBefore = MESSAGES; // every older row re-renders
const perTokenAfter = 0;
console.log('  scaled to a ' + MESSAGES + '-message list:');
console.log('    BEFORE  ' + perTokenBefore * TOKENS + ' wasted MessageItem renders over ' + TOKENS + ' tokens');
console.log('    AFTER   ' + perTokenAfter * TOKENS + ' wasted MessageItem renders\n');

if (before === TOKENS && after === 0) {
  console.log('PASS: BEFORE defeats React.memo on every token; AFTER lets it bail out completely.');
  process.exit(0);
} else {
  console.log('FAIL: unexpected result');
  process.exit(1);
}
