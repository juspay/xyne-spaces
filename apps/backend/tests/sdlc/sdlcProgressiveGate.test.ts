import { BASELINE_DEFINITIONS } from '../../src/sdlc/baselineDefinitions';
import {
  allBaselinesApproved,
  ARTIFACT_CAPABILITIES,
  BASELINE_CAPABILITIES,
} from '../../src/sdlc/sdlcProgressiveGate';

test('uses repository read access for baselines and artifacts', () => {
  expect(BASELINE_CAPABILITIES).toEqual(['READ_REPOSITORY']);
  expect(ARTIFACT_CAPABILITIES).toEqual(['READ_REPOSITORY']);
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

test('treats an edited baseline as pending reapproval', () => {
  const approved = BASELINE_DEFINITIONS.map((definition) => ({
    metadata: {
      artifactKind: 'BASELINE',
      baselineKind: definition.kind,
      approvedAt: '2026-08-04T00:00:00.000Z',
    },
    lastEditedAt: new Date('2026-08-04T00:00:00.000Z'),
  }));

  expect(allBaselinesApproved(approved)).toBe(true);
  expect(
    allBaselinesApproved([
      ...approved.slice(0, -1),
      { ...approved.at(-1)!, lastEditedAt: new Date('2026-08-04T00:00:00.001Z') },
    ])
  ).toBe(false);
});

test('defines seven compact baseline documents', () => {
  expect(BASELINE_DEFINITIONS.map((definition) => definition.kind)).toEqual([
    'CORE_CODE_MAP',
    'FRONTEND_DESIGN_SYSTEM',
    'BACKEND_DESIGN_SYSTEM',
    'CODE_LINT_STANDARDS',
    'COMMIT_STANDARDS',
    'RUN_GUIDE',
    'TEST_GUIDE',
  ]);
  expect(BASELINE_DEFINITIONS.every((definition) => definition.sections.length === 5)).toBe(true);
});
