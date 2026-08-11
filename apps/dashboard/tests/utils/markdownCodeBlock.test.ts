import assert from 'node:assert/strict';
import test from 'node:test';
import { isMarkdownCodeBlock, markdownCodeLanguage } from '../../src/utils/markdownCodeBlock.ts';

void test('recognizes a language-tagged fenced code block', () => {
  assert.equal(isMarkdownCodeBlock('language-json', '{\n  "id": 1\n}\n'), true);
  assert.equal(markdownCodeLanguage('hljs language-json'), 'json');
});

void test('recognizes a language-less fence from its trailing newline', () => {
  assert.equal(isMarkdownCodeBlock(undefined, 'const answer = 42;\n'), true);
});

void test('keeps inline code inline', () => {
  assert.equal(isMarkdownCodeBlock(undefined, 'const answer = 42;'), false);
  assert.equal(markdownCodeLanguage(undefined), '');
});
