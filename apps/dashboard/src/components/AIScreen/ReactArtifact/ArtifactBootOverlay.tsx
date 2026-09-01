/**
 * Covers the frame with the Xyne mark while the sandbox boots.
 *
 * Sandpack does not bundle in-page: the preview is an iframe served by the
 * CodeSandbox bundler, which has to be fetched, resolve the app's dependencies
 * and transpile before anything paints. That is seconds, and what filled them
 * was CodeSandbox's own loader — someone else's brand, in the middle of ours.
 *
 * `sandpack.status` is NOT the signal. It flips to "running" the moment the
 * client is instantiated, long before the bundle exists, so an overlay keyed to
 * it disappears against a blank iframe. The truth is the message stream —
 * `done` means compiled and painted — which is exactly what Sandpack's own
 * overlay listens to.
 *
 * Rendered as a sibling of `SandpackLayout` rather than a child of
 * `SandpackPreview` so it covers *everything* Sandpack draws, including the
 * bottom-left progress line and the stdout preview, which sit outside the
 * loading overlay and carry their own stacking. `.sp-wrapper` is the positioned
 * ancestor (sandpackOverrides.css pins it `inset: 0`), so `inset-0` here fills
 * the whole artifact frame.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { useSandpack } from '@codesandbox/sandpack-react';
import { AppLoaderMark } from '../../AppLoader/AppLoaderMark';

/**
 * `fill` carries both the scale and the surface, because they always move
 * together: the panel fills its own background and wants a bigger mark, the
 * inline card sits on `--card` and wants a smaller one. Those two tokens differ
 * in dark mode, so an overlay hard-coded to either shows as a rectangle of the
 * wrong shade inside the other.
 */
export const ArtifactBootOverlay = ({ fill }: { fill: boolean }): ReactElement | null => {
  const { sandpack, listen } = useSandpack();
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // No clientId: this provider owns exactly one client, and a global listener
    // cannot miss messages by subscribing before that client is created.
    const unsubscribe = listen(message => {
      if (message.type === 'done') setBooted(true);
      // A refresh or a files change restarts the bundler. `firstLoad` is what
      // separates that from the incremental recompiles that follow, which must
      // not throw the loader back up over a running app.
      else if (message.type === 'start' && message.firstLoad === true) setBooted(false);
    });
    return () => unsubscribe();
  }, [listen]);

  // A bundler timeout is reported through Sandpack's error overlay, which we
  // leave alone. Covering it would turn a stated failure — with its retry
  // button — into a loader that never ends.
  if (booted || sandpack.status === 'timeout') return null;

  return (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center ${
        fill ? 'bg-background' : 'bg-card'
      }`}
      role='status'
      aria-label='Loading app'
    >
      <AppLoaderMark size={fill ? 'md' : 'sm'} />
    </div>
  );
};
