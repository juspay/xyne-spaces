import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  BUBBLE_BEHIND_STEP,
  BUBBLE_EDGE_INSET,
  BUBBLE_LIST_GAP,
  BUBBLE_SIZE,
  BUBBLE_TUCK_DISTANCE,
} from '@/src/features/conversation/constants';
import {
  bubblesFor,
  clearParked,
  dismissBubbleToast,
  getBubbles,
  parkThread,
  reportBubbleAgents,
  resetBubblesForTests,
  unparkThread,
} from '@/src/features/conversation/model/bubble-store';
import {
  RESTING,
  behindDirection,
  bubbleFaceIds,
  bubbleListPlacement,
  bubbleRestX,
  bubbleSettleSide,
  bubbleTuckSide,
  clampBubbleY,
  faceMosaic,
  frameFollow,
  isOverCloseTarget,
  nextAgentState,
  stepTrail,
  trailSettled,
  withParked,
  withoutParked,
  type ParkedThread,
} from '@/src/features/conversation/model/bubbles';

const thread = (threadId: string, title = `Thread ${threadId}`): ParkedThread => ({
  channelId: 'c1',
  threadId,
  title,
  channelName: '#payments-core',
  faceIds: ['u1'],
});

describe('withParked / withoutParked', () => {
  it('puts the newest in front, each thread once', () => {
    const parked = withParked(withParked(withParked([], thread('a')), thread('b')), thread('a'));
    assert.deepEqual(
      parked.map(entry => entry.threadId),
      ['a', 'b'],
    );
  });

  it('lets one go and keeps the list when it was not there', () => {
    const parked = [thread('a'), thread('b')];
    assert.deepEqual(
      withoutParked(parked, 'a').map(entry => entry.threadId),
      ['b'],
    );
    assert.equal(withoutParked(parked, 'z'), parked);
  });
});

describe('bubbleFaceIds', () => {
  it('starts with whoever started it, then first repliers first, each once', () => {
    assert.deepEqual(
      bubbleFaceIds('root', ['b', 'root', 'c', 'b'], () => false),
      ['root', 'b', 'c'],
    );
  });

  it('moves agents to the front', () => {
    assert.deepEqual(
      bubbleFaceIds('root', ['agent', 'b'], id => id === 'agent'),
      ['agent', 'root', 'b'],
    );
  });

  it('works without a root sender', () => {
    assert.deepEqual(
      bubbleFaceIds(undefined, ['a'], () => false),
      ['a'],
    );
  });
});

describe('faceMosaic', () => {
  it('draws one 32, two 24s or a 28 and two 20s on the bubble', () => {
    assert.deepEqual(
      faceMosaic(['a'], 'bubble').faces.map(face => face.slot.size),
      [32],
    );
    assert.deepEqual(
      faceMosaic(['a', 'b'], 'bubble').faces.map(face => face.slot.size),
      [24, 24],
    );
    assert.deepEqual(
      faceMosaic(['a', 'b', 'c'], 'bubble').faces.map(face => face.slot.size),
      [28, 20, 20],
    );
    assert.equal(faceMosaic(['a', 'b', 'c'], 'bubble').more, null);
  });

  it('turns the last slot into +N past three', () => {
    const mosaic = faceMosaic(['a', 'b', 'c', 'd', 'e'], 'bubble');
    assert.deepEqual(
      mosaic.faces.map(face => face.userId),
      ['a', 'b'],
    );
    assert.equal(mosaic.more?.count, 3);
    assert.equal(mosaic.more?.slot.size, 20);
  });

  it('uses the row tile sizes', () => {
    assert.deepEqual(
      faceMosaic(['a'], 'row').faces.map(face => face.slot.size),
      [24],
    );
    assert.deepEqual(
      faceMosaic(['a', 'b', 'c'], 'row').faces.map(face => face.slot.size),
      [20, 16, 16],
    );
  });

  it('draws nothing without faces', () => {
    assert.deepEqual(faceMosaic([], 'bubble'), { faces: [], more: null });
  });
});

describe('nextAgentState', () => {
  const working = { agentIds: ['claw'], agentName: 'Xyne Claw' };

  it('works while an agent runs', () => {
    assert.deepEqual(nextAgentState(RESTING, working), {
      state: { kind: 'working', ...working },
      answeredNow: false,
    });
  });

  it('answers once the agents finish, only from working', () => {
    const answered = nextAgentState({ kind: 'working', ...working }, null);
    assert.equal(answered.answeredNow, true);
    assert.deepEqual(answered.state, { kind: 'answered', ...working });
    assert.deepEqual(nextAgentState(RESTING, null), { state: RESTING, answeredNow: false });
    assert.equal(nextAgentState(answered.state, null).answeredNow, false);
  });
});

describe('bubble geometry', () => {
  const width = 393;

  it('rests 14 from either side', () => {
    assert.equal(bubbleRestX('left', width), BUBBLE_EDGE_INSET);
    assert.equal(bubbleRestX('right', width), width - BUBBLE_EDGE_INSET - BUBBLE_SIZE);
  });

  it('snaps to the nearer side, projecting a fling', () => {
    assert.equal(bubbleSettleSide(40, 0, width), 'left');
    assert.equal(bubbleSettleSide(300, 0, width), 'right');
    assert.equal(bubbleSettleSide(100, 2000, width), 'right');
  });

  it('tucks only when pushed past an edge by more than the tuck distance', () => {
    assert.equal(bubbleTuckSide(-BUBBLE_TUCK_DISTANCE, width), null);
    assert.equal(bubbleTuckSide(-BUBBLE_TUCK_DISTANCE - 1, width), 'left');
    assert.equal(bubbleTuckSide(width - BUBBLE_SIZE + BUBBLE_TUCK_DISTANCE + 1, width), 'right');
  });

  it('clamps y, keeping the top when the range is empty', () => {
    assert.equal(clampBubbleY(10, 60, 600), 60);
    assert.equal(clampBubbleY(700, 60, 600), 600);
    assert.equal(clampBubbleY(300, 60, 40), 60);
  });

  it('trails below in the top half and above in the bottom half', () => {
    assert.equal(behindDirection(100, 852), 1);
    assert.equal(behindDirection(600, 852), -1);
  });

  it('counts the close target within its slop', () => {
    const target = { x: 150, y: 760, width: 96, height: 40 };
    assert.equal(isOverCloseTarget(170, 750, target), true);
    assert.equal(isOverCloseTarget(20, 120, target), false);
  });
});

describe('the trail', () => {
  it('folds every card one step past the bubble', () => {
    const trail = stepTrail([0, 0, 0, 0], 100, 200, 1, false, 1);
    assert.deepEqual(trail, [100, 200 + BUBBLE_BEHIND_STEP, 100, 200 + BUBBLE_BEHIND_STEP]);
    assert.equal(trailSettled(trail, trail), true);
  });

  it('spreads each card a step past the one ahead', () => {
    const trail = stepTrail([0, 0, 0, 0], 100, 200, -1, true, 1);
    assert.deepEqual(trail, [100, 200 - BUBBLE_BEHIND_STEP, 100, 200 - BUBBLE_BEHIND_STEP * 2]);
  });

  it('closes part of the gap per frame', () => {
    const [x] = stepTrail([0, 0], 100, 0, 1, false, 0.5);
    assert.equal(x, 50);
    assert.equal(frameFollow(0.5, 1000 / 60), 0.5);
    assert.equal(frameFollow(1, 5), 1);
    assert.ok(frameFollow(0.5, 2000 / 60) > 0.5);
  });
});

describe('bubbleListPlacement', () => {
  it('grows down from a bubble at the top right, lined up with its edge', () => {
    assert.deepEqual(bubbleListPlacement(321, 120, 393, 852), {
      side: 'right',
      sideInset: BUBBLE_EDGE_INSET,
      edgeOffset: 120 + BUBBLE_SIZE + BUBBLE_LIST_GAP,
      growsDown: true,
    });
  });

  it('grows up from a bubble at the bottom left', () => {
    assert.deepEqual(bubbleListPlacement(14, 600, 393, 852), {
      side: 'left',
      sideInset: BUBBLE_EDGE_INSET,
      edgeOffset: 852 - 600 + BUBBLE_LIST_GAP,
      growsDown: false,
    });
  });
});

describe('bubble store', () => {
  beforeEach(() => resetBubblesForTests());

  it('shows parked threads only to the scope that parked them', () => {
    parkThread('w1:u1', thread('a'));
    assert.equal(bubblesFor(getBubbles(), 'w1:u1').parked.length, 1);
    assert.equal(bubblesFor(getBubbles(), 'w2:u1').parked.length, 0);
    assert.equal(bubblesFor(getBubbles(), null).parked.length, 0);
  });

  it('starts a fresh stack for a new scope', () => {
    parkThread('w1:u1', thread('a'));
    parkThread('w2:u1', thread('b'));
    assert.deepEqual(
      getBubbles().parked.map(entry => entry.threadId),
      ['b'],
    );
  });

  it('drops a toast once an agent answers, and keeps the dot until the thread goes', () => {
    parkThread('s', thread('a', 'Has this happened before?'));
    reportBubbleAgents('a', { agentIds: ['claw'], agentName: 'Xyne Claw' });
    assert.equal(getBubbles().agents['a']?.kind, 'working');
    reportBubbleAgents('a', null);
    assert.equal(getBubbles().agents['a']?.kind, 'answered');
    assert.deepEqual(getBubbles().toast, {
      threadId: 'a',
      title: 'Has this happened before?',
      agentIds: ['claw'],
      agentName: 'Xyne Claw',
    });
    dismissBubbleToast('a');
    assert.equal(getBubbles().toast, null);
    assert.equal(getBubbles().agents['a']?.kind, 'answered');
    unparkThread('a');
    assert.equal(getBubbles().agents['a'], undefined);
  });

  it('ignores agents of threads that are not parked', () => {
    reportBubbleAgents('z', { agentIds: ['claw'], agentName: null });
    assert.deepEqual(getBubbles().agents, {});
  });

  it('puts everything down but keeps the scope', () => {
    parkThread('s', thread('a'));
    parkThread('s', thread('b'));
    clearParked();
    assert.equal(getBubbles().parked.length, 0);
    assert.equal(getBubbles().scope, 's');
  });
});
