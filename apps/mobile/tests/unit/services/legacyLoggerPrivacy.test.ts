import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const loggerPath = resolve(process.cwd(), 'src/utils/logger.ts');

test('legacy logger honors the remote logging opt-out before queueing', () => {
  const source = readFileSync(loggerPath, 'utf8');

  assert.match(
    source,
    /private readonly remoteLoggingEnabled = LOGGER_CONFIG\.remoteLoggingEnabled/,
  );
  assert.match(source, /if \(!this\.remoteLoggingEnabled\) \{\s*return;\s*\}/);
});

test('legacy logger keeps console diagnostics independent of remote delivery', () => {
  const source = readFileSync(loggerPath, 'utf8');
  const consoleIndex = source.indexOf('console.log(`${emoji} [${level}] ${event}`');
  const optOutIndex = source.indexOf('if (!this.remoteLoggingEnabled)', consoleIndex);

  assert.ok(consoleIndex >= 0);
  assert.ok(optOutIndex > consoleIndex);
});
