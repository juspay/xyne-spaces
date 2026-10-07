/**
 * Regression: every inline video bubble re-rendered on every attachmentViewer
 * snapshot. While a video plays in the attachment modal, VideoViewer sends
 * SET_VIDEO_TIME on each `timeupdate` (~4 Hz), so N bystander bubbles each
 * re-rendered ~4x/second for the whole playback.
 *
 * Uses the REAL attachmentViewerActor and the REAL hook InlineVideoPlayer uses.
 */
import * as React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';

vi.mock('../../../../services/clients/fileFetchService', () => ({
  fetchFile: vi.fn(async () => ({ name: 'v.mp4' })),
}));

const JSDOM_PATH =
  '/workspace/xyne-spaces/node_modules/.pnpm/jsdom@28.1.0_@noble+hashes@2.2.0/node_modules/jsdom/lib/api.js';

type Hook = typeof import('../useInlineVideoModalState').useInlineVideoModalState;
let useInlineVideoModalState: Hook;
let actor: typeof import('../../../../machines/attachmentViewerMachine').attachmentViewerActor;
let createRoot: typeof import('react-dom/client').createRoot;
let root: import('react-dom/client').Root | null = null;

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { JSDOM } = await import(/* @vite-ignore */ JSDOM_PATH);
  const dom = new JSDOM('<!doctype html><html><body><div id="r"></div></body></html>');
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.navigator = dom.window.navigator;
  g.HTMLElement = dom.window.HTMLElement;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  ({ useInlineVideoModalState } = await import('../useInlineVideoModalState'));
  ({ attachmentViewerActor: actor } = await import('../../../../machines/attachmentViewerMachine'));
  ({ createRoot } = await import('react-dom/client'));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  act(() => actor.send({ type: 'CLOSE' }));
});

const att = (id: string) =>
  ({ attachmentId: id, fileName: `${id}.mp4`, mimeType: 'video/mp4' }) as never;

async function openInModal(id: string) {
  await act(async () => {
    actor.send({ type: 'OPEN', attachments: [att(id)], startIndex: 0 });
    await new Promise(r => setTimeout(r, 0));
  });
  expect(actor.getSnapshot().value).toBe('viewing');
}

function mount(ui: React.ReactElement) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(ui));
}

describe('InlineVideoPlayer modal-state subscription', () => {
  it('bystander video bubbles do not re-render while the modal video plays', async () => {
    const BYSTANDERS = 30;
    const TICKS = 40; // ~10s of playback at 4 Hz timeupdate
    const renders = new Array(BYSTANDERS).fill(0);
    const Probe = ({ i }: { i: number }) => {
      useInlineVideoModalState(`bystander-${i}`);
      renders[i]++;
      return null;
    };
    mount(
      <>
        {renders.map((_, i) => (
          <Probe key={i} i={i} />
        ))}
      </>,
    );
    await openInModal('owner');
    renders.fill(0);

    for (let t = 1; t <= TICKS; t++) {
      act(() => actor.send({ type: 'SET_VIDEO_TIME', time: t * 0.25 }));
    }
    const total = renders.reduce((a, b) => a + b, 0);
    // eslint-disable-next-line no-console
    console.log(`[inline-video] bystanders=${BYSTANDERS} ticks=${TICKS} wasted re-renders=${total}`);
    expect(total).toBe(0);
  });

  it('owner bubble still sees open→closed and the final modal time (pause/resume preserved)', async () => {
    const seen: Array<{ open: boolean; time: number | undefined }> = [];
    const Owner = () => {
      const r = useInlineVideoModalState('owner') as {
        isOpenInModal: boolean;
        modalVideoTime?: number;
        readModalVideoTime?: () => number | undefined;
      };
      seen.push({
        open: r.isOpenInModal,
        time: r.readModalVideoTime ? r.readModalVideoTime() : r.modalVideoTime,
      });
      return null;
    };
    mount(<Owner />);
    await openInModal('owner');
    for (let t = 1; t <= 8; t++) act(() => actor.send({ type: 'SET_VIDEO_TIME', time: t }));
    act(() => actor.send({ type: 'CLOSE' }));
    expect(seen.some(s => s.open)).toBe(true);
    const last = seen[seen.length - 1]!;
    expect(last.open).toBe(false);
    expect(last.time).toBe(8);
  });
});
