import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldLoadSdlcWikiPages,
  shouldLoadSdlcWikiRun,
} from '../../../src/routes/SdlcScreen/sdlcWikiQueryPolicy.ts';

void test('Repo Knowledge does not depend on Wiki queries', () => {
  assert.equal(shouldLoadSdlcWikiRun('baseline'), false);
  assert.equal(shouldLoadSdlcWikiPages('baseline'), false);
});

void test('Wiki loads both pages and run status', () => {
  assert.equal(shouldLoadSdlcWikiRun('wiki'), true);
  assert.equal(shouldLoadSdlcWikiPages('wiki'), true);
});
