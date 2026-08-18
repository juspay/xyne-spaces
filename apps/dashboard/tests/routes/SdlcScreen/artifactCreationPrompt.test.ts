import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSdlcArtifactCreationPrompt } from '../../../src/routes/SdlcScreen/artifactCreationPrompt.ts';

void test('builds a repository-pinned PRD creation request', () => {
  assert.equal(
    buildSdlcArtifactCreationPrompt({
      kind: 'PRD',
      title: 'Search experience',
      repositoryName: 'xyne-spaces',
      direction: 'Focus on acceptance criteria.',
    }),
    'Create a PRD titled "Search experience" in repository "xyne-spaces".\n\nUser direction: Focus on acceptance criteria.',
  );
});

void test('builds a Tech Doc request with its canonical parent PRD', () => {
  assert.equal(
    buildSdlcArtifactCreationPrompt({
      kind: 'TECH_DOC',
      title: 'Search architecture',
      repositoryName: 'xyne-spaces',
      parentPrd: { canvasId: 'prd-canvas-1', title: 'Search experience' },
    }),
    'Create a Tech Doc titled "Search architecture" for the PRD "Search experience" (canvas ID: prd-canvas-1) in repository "xyne-spaces".',
  );
});
