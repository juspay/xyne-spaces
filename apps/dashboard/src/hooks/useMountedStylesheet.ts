import { useLayoutEffect } from 'react';

const attached = new Map<string, { element: HTMLStyleElement; users: number }>();

/**
 * Attaches `css` to the document only while at least one component using it is
 * mounted, for large third-party stylesheets that would otherwise be matched
 * against every element on every style recalc for the whole session.
 *
 * The `<style>` is prepended to `<head>`, ahead of the app bundle, so the app's
 * own overrides still win ties exactly as they do for bundled CSS.
 */
export const useMountedStylesheet = (css: string): void => {
  useLayoutEffect(() => {
    let entry = attached.get(css);
    if (!entry) {
      const element = document.createElement('style');
      element.textContent = css;
      document.head.prepend(element);
      entry = { element, users: 0 };
      attached.set(css, entry);
    }
    const current = entry;
    current.users++;
    return (): void => {
      current.users--;
      if (current.users === 0) {
        current.element.remove();
        attached.delete(css);
      }
    };
  }, [css]);
};
