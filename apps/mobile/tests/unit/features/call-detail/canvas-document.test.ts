import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as Y from 'yjs';

import {
  blocksFromBlockNoteJson,
  blocksFromYFragment,
  CANVAS_XML_FRAGMENT,
  isCanvasDocumentEmpty,
} from '@/src/features/call-detail/utils/canvas-document';

/** Build one y-prosemirror blockContainer the way BlockNote stores it. */
function container(id: string, block: Y.XmlElement, children: Y.XmlElement[] = []): Y.XmlElement {
  const node = new Y.XmlElement('blockContainer');
  node.setAttribute('id', id);
  node.insert(0, children.length > 0 ? [block, group(children)] : [block]);
  return node;
}

function group(containers: Y.XmlElement[]): Y.XmlElement {
  const node = new Y.XmlElement('blockGroup');
  node.insert(0, containers);
  return node;
}

function element(
  name: string,
  attrs: Record<string, string>,
  children: Array<Y.XmlText | Y.XmlElement>,
): Y.XmlElement {
  const node = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.insert(0, children);
  return node;
}

describe('canvas document from Yjs', () => {
  it('reads headings, styled text, links, mentions, citations, nesting and tables', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment(CANVAS_XML_FRAGMENT);

    const headingText = new Y.XmlText();
    const paragraphText = new Y.XmlText();
    const bulletText = new Y.XmlText();
    const childText = new Y.XmlText();
    const cellText = new Y.XmlText();

    const citation = element(
      'citation',
      {
        callId: 'call-1',
        segment: '7',
        timestamp: '04:32',
        speaker: 'Ana',
        snippet: 'We go with B',
        segments: '[{"n":7},{"n":8}]',
      },
      [],
    );
    const mention = element('mention', { userId: 'u1', username: 'Ben' }, []);

    const table = element('table', {}, [
      element('tableRow', {}, [
        element('tableHeader', {}, [element('tableParagraph', {}, [cellText])]),
      ]),
    ]);

    fragment.insert(0, [
      group([
        container('h', element('heading', { level: '2' }, [headingText])),
        container('p', element('paragraph', {}, [paragraphText, mention, citation])),
        container('b', element('bulletListItem', {}, [bulletText]), [
          container('c', element('numberedListItem', {}, [childText])),
        ]),
        container('t', table),
      ]),
    ]);

    // Text is filled after the nodes are attached to the doc (Yjs requirement).
    headingText.insert(0, 'Decisions');
    paragraphText.insert(0, 'See ');
    paragraphText.insert(4, 'the doc', { link: { href: 'https://example.com' }, bold: {} });
    paragraphText.insert(11, ' with ', { link: null, bold: null });
    bulletText.insert(0, 'Ship ');
    bulletText.insert(5, 'v2', { 'italic--abc': {} });
    childText.insert(0, 'nested');
    cellText.insert(0, 'Owner');

    // Round-trip through an update, as the app receives it from Y-Sweet.
    const received = new Y.Doc();
    Y.applyUpdate(received, Y.encodeStateAsUpdate(doc));
    const blocks = blocksFromYFragment(received.getXmlFragment(CANVAS_XML_FRAGMENT));

    assert.deepEqual(
      blocks.map(block => [block.id, block.type]),
      [
        ['h', 'heading'],
        ['p', 'paragraph'],
        ['b', 'bulletListItem'],
        ['t', 'table'],
      ],
    );
    assert.equal(blocks[0]?.props['level'], '2');

    const paragraph = blocks[1]?.content ?? [];
    assert.deepEqual(paragraph[0], { kind: 'text', text: 'See ', styles: {} });
    assert.deepEqual(paragraph[1], {
      kind: 'text',
      text: 'the doc',
      styles: { bold: true },
      href: 'https://example.com',
    });
    assert.deepEqual(paragraph[3], { kind: 'mention', userId: 'u1', label: 'Ben' });
    assert.deepEqual(paragraph[4], {
      kind: 'citation',
      callId: 'call-1',
      segment: 7,
      timestamp: '04:32',
      speaker: 'Ana',
      snippet: 'We go with B',
      count: 2,
    });

    const bullet = blocks[2];
    assert.deepEqual(bullet?.content[1], { kind: 'text', text: 'v2', styles: { italic: true } });
    assert.equal(bullet?.children[0]?.type, 'numberedListItem');
    assert.deepEqual(bullet?.children[0]?.content, [{ kind: 'text', text: 'nested', styles: {} }]);

    const rows = blocks[3]?.rows ?? [];
    assert.equal(rows[0]?.[0]?.isHeader, true);
    assert.deepEqual(rows[0]?.[0]?.content, [{ kind: 'text', text: 'Owner', styles: {} }]);
    assert.equal(isCanvasDocumentEmpty(blocks), false);
  });

  it('treats a fresh canvas (one empty paragraph) as empty', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment(CANVAS_XML_FRAGMENT);
    fragment.insert(0, [group([container('x', element('paragraph', {}, [new Y.XmlText()]))])]);
    assert.equal(isCanvasDocumentEmpty(blocksFromYFragment(fragment)), true);
    assert.deepEqual(blocksFromYFragment(new Y.Doc().getXmlFragment(CANVAS_XML_FRAGMENT)), []);
  });
});

describe('canvas document from BlockNote JSON', () => {
  it('reads blocks, links, styles, mentions and tables', () => {
    const blocks = blocksFromBlockNoteJson([
      {
        id: '1',
        type: 'paragraph',
        props: {},
        content: [
          { type: 'text', text: 'Hi ', styles: {} },
          {
            type: 'link',
            href: '/chat/canvas/abc',
            content: [{ type: 'text', text: 'here', styles: {} }],
          },
          { type: 'text', text: '!', styles: { bold: true, textColor: 'red' } },
          { type: 'mention', props: { userId: 'u2', username: 'Cy' } },
        ],
        children: [
          {
            id: '2',
            type: 'checkListItem',
            props: { checked: true },
            content: 'done',
            children: [],
          },
        ],
      },
      {
        id: '3',
        type: 'table',
        props: {},
        content: {
          type: 'tableContent',
          headerRows: 1,
          rows: [{ cells: [[{ type: 'text', text: 'A', styles: {} }]] }, { cells: [[]] }],
        },
        children: [],
      },
    ]);

    assert.deepEqual(blocks[0]?.content, [
      { kind: 'text', text: 'Hi ', styles: {} },
      { kind: 'text', text: 'here', styles: {}, href: '/chat/canvas/abc' },
      { kind: 'text', text: '!', styles: { bold: true, textColor: 'red' } },
      { kind: 'mention', userId: 'u2', label: 'Cy' },
    ]);
    assert.equal(blocks[0]?.children[0]?.type, 'checkListItem');
    assert.equal(blocks[0]?.children[0]?.props['checked'], true);
    assert.equal(blocks[1]?.rows?.[0]?.[0]?.isHeader, true);
    assert.equal(blocks[1]?.rows?.[1]?.[0]?.isHeader, false);
    assert.deepEqual(blocksFromBlockNoteJson(null), []);
    assert.equal(isCanvasDocumentEmpty(blocksFromBlockNoteJson([])), true);
  });
});

describe('canvas document from a real BlockNote Y-doc', () => {
  // Generated with @blocknote/server-util 0.54 `blocksToYDoc(blocks, 'document-store')`
  // — the same call the backend's initializeYSweetDoc makes for summary canvases.
  it('decodes what BlockNote itself writes', () => {
    const fixture = readFileSync(
      new URL('./fixtures/blocknote-0.54-summary.ydoc.b64', import.meta.url),
      'utf8',
    );
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(fixture, 'base64')));
    const blocks = blocksFromYFragment(doc.getXmlFragment(CANVAS_XML_FRAGMENT));

    assert.deepEqual(
      blocks.map(block => block.type),
      ['heading', 'paragraph', 'bulletListItem', 'checkListItem', 'codeBlock', 'quote', 'table'],
    );
    assert.equal(blocks[0]?.props['level'], 2);
    assert.deepEqual(blocks[1]?.content, [
      { kind: 'text', text: 'See ', styles: {} },
      { kind: 'text', text: 'the doc', styles: { bold: true }, href: 'https://example.com' },
      { kind: 'text', text: ' and ', styles: {} },
      { kind: 'text', text: 'red', styles: { italic: true, textColor: 'red' } },
    ]);
    assert.deepEqual(
      blocks[2]?.children.map(child => [child.type, child.content[0]]),
      [
        ['numberedListItem', { kind: 'text', text: 'nested one', styles: {} }],
        ['numberedListItem', { kind: 'text', text: 'nested two', styles: {} }],
      ],
    );
    assert.equal(blocks[3]?.props['checked'], true);
    assert.equal(blocks[4]?.props['language'], 'ts');
    assert.deepEqual(
      blocks[6]?.rows?.map(row =>
        row.map(cell => cell.content[0]?.kind === 'text' && cell.content[0].text),
      ),
      [
        ['Owner', 'Task'],
        ['Ana', 'Write RFC'],
      ],
    );
  });
});
