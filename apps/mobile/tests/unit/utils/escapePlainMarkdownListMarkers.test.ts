import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { escapePlainTextMarkdownListMarkersInHtmlParagraphs } from '@/src/utils/escapePlainMarkdownListMarkers';

const run = escapePlainTextMarkdownListMarkersInHtmlParagraphs;

describe('escapePlainTextMarkdownListMarkersInHtmlParagraphs', () => {
  it('escapes a leading unordered list marker inside a paragraph', () => {
    assert.equal(run('<p>- item</p>'), '<p>\\- item</p>');
    assert.equal(run('<p>* item</p>'), '<p>\\* item</p>');
    assert.equal(run('<p>+ item</p>'), '<p>\\+ item</p>');
  });

  it('escapes a leading ordered list marker inside a paragraph', () => {
    assert.equal(run('<p>1. item</p>'), '<p>1\\. item</p>');
    assert.equal(run('<p>2) item</p>'), '<p>2\\) item</p>');
  });

  it('escapes markers that follow a <br> line break', () => {
    assert.equal(run('<p>x<br>- y</p>'), '<p>x<br>\\- y</p>');
  });

  it('leaves markers that are not at the start of a line untouched', () => {
    assert.equal(run('<p>a - b</p>'), '<p>a - b</p>');
  });

  it('only touches content inside paragraphs', () => {
    assert.equal(run('- outside <p>- inside</p>'), '- outside <p>\\- inside</p>');
  });

  it('does not alter blank paragraphs', () => {
    assert.equal(run('<p>&nbsp;</p>'), '<p>&nbsp;</p>');
    assert.equal(run('<p><br></p>'), '<p><br></p>');
  });

  it('leaves ordinary text unchanged', () => {
    assert.equal(run('<p>hello world</p>'), '<p>hello world</p>');
  });
});
