import { useEffect, useRef, type ReactElement } from 'react';

/** How often a playing video's backdrop catches up with it: often enough to follow a
 *  scene, rarely enough to cost nothing. */
const VIDEO_SAMPLE_MS = 160;
/** The frame is shrunk to this before blurring: colour is all that's kept. */
const SAMPLE_WIDTH = 48;
const SAMPLE_HEIGHT = 27;

const BACKDROP =
  'pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-[72px] saturate-150 motion-reduce:hidden';

/**
 * The picture's own colours, spread far out and soft behind it — YouTube's ambient
 * mode — in place of a flat backdrop. A wash of the page's background over it keeps
 * it a glow, not a second picture.
 */
export function AmbientImage(props: { src: string }): ReactElement {
  return (
    <div aria-hidden='true' className='pointer-events-none absolute inset-0 overflow-hidden'>
      <img src={props.src} alt='' className={BACKDROP} />
      <div className='absolute inset-0 bg-background/45' />
    </div>
  );
}

/**
 * The same for a video, following it as it plays: its frame drawn small on a
 * canvas — on load, on every seek and a few times a second while it plays — and
 * blurred out behind it.
 */
export function AmbientVideo(props: { video: HTMLVideoElement | null }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const video = props.video;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!video || !context) return;
    const draw = (): void => {
      if (video.readyState < 2) return;
      try {
        context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      } catch {
        // A frame the canvas may not take — the backdrop keeps the last one.
      }
    };
    let timer: number | null = null;
    const follow = (): void => {
      if (timer === null) timer = window.setInterval(draw, VIDEO_SAMPLE_MS);
    };
    const stop = (): void => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      draw();
    };
    const events: [string, () => void][] = [
      ['loadeddata', draw],
      ['seeked', draw],
      ['play', follow],
      ['pause', stop],
      ['ended', stop],
    ];
    events.forEach(([name, handler]) => video.addEventListener(name, handler));
    draw();
    if (!video.paused) follow();
    return () => {
      events.forEach(([name, handler]) => video.removeEventListener(name, handler));
      if (timer !== null) window.clearInterval(timer);
    };
  }, [props.video]);

  return (
    <div aria-hidden='true' className='pointer-events-none absolute inset-0 overflow-hidden'>
      <canvas ref={canvasRef} width={SAMPLE_WIDTH} height={SAMPLE_HEIGHT} className={BACKDROP} />
      <div className='absolute inset-0 bg-black/35' />
    </div>
  );
}
