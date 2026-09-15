import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');

test('Jenkins adapter is parameterized, conditional, secret-bound, and always archives reports', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'performance', 'ci', 'jenkins-performance-stage.groovy'),
    'utf8',
  );

  for (const parameter of [
    'RUN_PERFORMANCE_TESTS',
    'PERF_PROFILE',
    'PERF_ENVIRONMENT',
    'PERF_SCENARIO',
    'PERF_VUS_OVERRIDE',
    'PERF_DURATION_OVERRIDE',
  ]) {
    assert.match(source, new RegExp(parameter));
  }
  assert.match(source, /when\s*\{[\s\S]*RUN_PERFORMANCE_TESTS/);
  assert.match(source, /withCredentials/);
  assert.match(source, /pnpm perf:run/);
  assert.match(source, /post\s*\{[\s\S]*always[\s\S]*archiveArtifacts/);
  assert.doesNotMatch(source, /production/);
});

test('k6 configuration excludes raw URL tags from reports and remote metrics', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'performance', 'k6', 'lib', 'config.js'),
    'utf8',
  );
  const systemTags = source.match(/systemTags:\s*\[([^\]]+)]/)?.[1] ?? '';

  assert.notEqual(systemTags, '', 'systemTags must be explicit');
  assert.doesNotMatch(systemTags, /['"]url['"]/);
  assert.match(systemTags, /['"]name['"]/);
});

test('Jenkins adapter bounds the stage so a hung run cannot hold an agent forever', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'performance', 'ci', 'jenkins-performance-stage.groovy'),
    'utf8',
  );

  assert.match(source, /timeout\(/);
  // The ceiling must cover the longest legal run: preprod allows an 8h duration.
  assert.match(source, /unit:\s*'HOURS'/);
});

test('Jenkins adapter offers the Zero and REST scenarios by their explicit names', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'performance', 'ci', 'jenkins-performance-stage.groovy'),
    'utf8',
  );

  assert.match(source, /'zero-query-transform'/);
  assert.match(source, /'rest-messaging'/);
  assert.doesNotMatch(source, /'messaging'/);
});

test('the Zero query scenario reads only, so a run needs no fixture reset', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'performance', 'k6', 'scenarios', 'zero-query-transform.js'),
    'utf8',
  );

  assert.match(source, /\/api\/zero\/query/);
  // One POST helper (the query endpoint is itself a POST) and no write endpoints.
  assert.doesNotMatch(source, /\/api\/conversations/);
  assert.doesNotMatch(source, /http\.(put|patch|del)\(/);
});

test('the Zero query scenario sends the verified transform envelope only', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'performance', 'k6', 'scenarios', 'zero-query-transform.js'),
    'utf8',
  );

  assert.match(source, /buildTransformMessage/);
  // The encoding is settled from the library source; probing alternatives is gone.
  assert.doesNotMatch(source, /ARG_ENCODINGS|encodeArgs/);
  // A rejected fixture token must be reported as an environment fault, not a slow product.
  assert.match(source, /ENVIRONMENT_FAILURE[^\n]*token rejected/);
});

test('the Zero query scenario treats a TransformFailed 200 as a failure', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'performance', 'k6', 'scenarios', 'zero-query-transform.js'),
    'utf8',
  );

  assert.match(source, /isTransformFailure/);
});
