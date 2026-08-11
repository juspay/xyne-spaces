import { BASELINE_DEFINITIONS } from '../../src/sdlc/baselineDefinitions';
import {
  allBaselinesApproved,
  ARTIFACT_CAPABILITIES,
  BASELINE_CAPABILITIES,
  START_WORK_CAPABILITIES,
} from '../../src/sdlc/sdlcProgressiveGate';

test('uses read for baseline/artifacts and read+push+PR for Start Work', () => {
  expect(BASELINE_CAPABILITIES).toEqual(['READ_REPOSITORY']);
  expect(ARTIFACT_CAPABILITIES).toEqual(['READ_REPOSITORY']);
  expect(START_WORK_CAPABILITIES).toEqual([
    'READ_REPOSITORY',
    'PUSH_BRANCH',
    'CREATE_PULL_REQUEST',
  ]);
});

test('keeps artifacts locked until every distinct baseline is approved', () => {
  const approved = BASELINE_DEFINITIONS.map((definition) => ({
    metadata: {
      artifactKind: 'BASELINE',
      baselineKind: definition.kind,
      approvedAt: '2026-08-04T00:00:00.000Z',
    },
  }));

  expect(allBaselinesApproved([])).toBe(false);
  expect(allBaselinesApproved(approved.slice(0, -1))).toBe(false);
  expect(allBaselinesApproved([...approved.slice(0, -1), approved[0]])).toBe(false);
  expect(allBaselinesApproved(approved)).toBe(true);
});
