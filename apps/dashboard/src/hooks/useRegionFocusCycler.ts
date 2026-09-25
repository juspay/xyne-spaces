import { useEffect } from 'react';

const REGION_SELECTOR = '[data-focus-region]';
const SEAT_SELECTOR = '[data-focus-seat]';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const isVisible = (el: HTMLElement): boolean => el.getClientRects().length > 0;

// What ↑/↓ "items" are inside each data-focus-region (Slack's "move focus
// between items in a list": channels, nav buttons, messages).
const LIST_ITEMS: Record<string, string> = {
  'chat-directory': '[data-arrow-item]',
  'app-sidebar': 'a[href], button',
  conversation: '[data-message-row]',
  thread: '[data-message-row]',
};

// Horizontal "toolbar" strips (Slack's top bars): a container marked
// `data-arrow-row` walks its buttons/links with plain ←/→, wrapping at the
// ends like every native toolbar. Inputs inside are left to the native caret.
const ROW_SELECTOR = '[data-arrow-row]';
const ROW_ITEMS = 'button, a[href]';

const itemsOfRegion = (region: HTMLElement, selector: string): HTMLElement[] =>
  Array.from(region.querySelectorAll<HTMLElement>(selector)).filter(
    el => el.closest(REGION_SELECTOR) === region && isVisible(el) && !el.hasAttribute('disabled'),
  );

/**
 * useRegionFocusCycler — Slack-style major-section focus hopping.
 *
 * Mirrors Slack's "Navigate with your keyboard" model:
 *   - ⌘ Ctrl → / ←                    (Mac, desktop-app binding)
 *   - ⌘ F6 / ⌘ ⇧ F6   Ctrl+(Shift+)F6 (Mac/Win, browser binding — plain F6 is
 *     intercepted by Chrome/Safari, so the page usually never sees it)
 *   - plain F6 / ⇧ F6 attempts also accepted (work when the browser allows)
 *
 * Regions are declared with `data-focus-region` on landmark containers in
 * DOM order (e.g. chat sidebar → conversation view → composer → thread).
 * A region's preferred focus target inside it is marked with
 * `data-focus-seat` (e.g. the active channel row); fallbacks: first
 * focusable descendant, then the region element itself.
 *
 * While a modal dialog is focused the cycler stays out of the way — the
 * dialog's focus trap owns focus until it closes.
 */
export const useRegionFocusCycler = (): void => {
  useEffect((): (() => void) => {
    const walkList = (e: KeyboardEvent): boolean => {
      const dirKey = e.key === 'ArrowUp' ? -1 : 1;
      const active = document.activeElement as HTMLElement | null;
      if (!active) return false;
      if (active.closest('[role="dialog"][aria-modal="true"], [data-overlay-portal]')) return false;

      const region = active.closest<HTMLElement>(REGION_SELECTOR);
      const regionName = region?.getAttribute('data-focus-region') ?? '';

      // Composer: ↑ with an EMPTY field leaves the field for the message list
      // (Slack pattern). Non-empty or ↓ stay plain text editing.
      if (regionName === 'composer') {
        if (e.key !== 'ArrowUp' || (active.textContent ?? '').trim().length > 0) return false;
        // The message list this composer belongs to: the thread pane when the
        // composer sits inside a marked thread region, else the conversation.
        const conv =
          active.closest<HTMLElement>(
            '[data-focus-region="thread"], [data-focus-region="conversation"]',
          ) ?? document.querySelector<HTMLElement>('[data-focus-region="conversation"]');
        const rows = conv ? itemsOfRegion(conv, '[data-message-row]') : [];
        const last = rows[rows.length - 1];
        if (!last) return false;
        e.preventDefault();
        e.stopPropagation();
        last.focus({ preventScroll: true });
        last.scrollIntoView({ block: 'nearest' });
        return true;
      }

      const selector = LIST_ITEMS[regionName];
      if (!region || !selector) return false;

      const tag = active.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) {
        return false;
      }

      const items = itemsOfRegion(region, selector);
      if (items.length === 0) return false;

      const idx = items.indexOf(active);
      // Not on an item (e.g. a header button inside the region): first/last
      // item starts the walk.
      let target: HTMLElement | undefined;
      if (idx === -1) {
        target = dirKey === 1 ? items[0] : items[items.length - 1];
      } else if (idx === items.length - 1 && dirKey === 1 && regionName === 'conversation') {
        // Slack: ↓ past the last message returns to the composer.
        const composer = region.querySelector<HTMLElement>('[data-focus-region="composer"]');
        target = composer?.querySelector<HTMLElement>(SEAT_SELECTOR) ?? composer ?? undefined;
      } else {
        target = items[idx + dirKey];
      }
      if (!target) return false;

      e.preventDefault();
      e.stopPropagation();
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest' });
      return true;
    };

    // ←/→ inside a `data-arrow-row` toolbar strip: walk buttons/links in DOM
    // order, wrap at both ends. Only fires when focus is already ON one of
    // the strip's items — anything else keeps native behavior.
    const walkRow = (e: KeyboardEvent): boolean => {
      const dirKey = e.key === 'ArrowLeft' ? -1 : 1;
      const active = document.activeElement as HTMLElement | null;
      if (!active) return false;
      if (active.closest('[role="dialog"][aria-modal="true"], [data-overlay-portal]')) return false;
      const tag = active.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return false;
      const row = active.closest<HTMLElement>(ROW_SELECTOR);
      if (!row) return false;
      const items = Array.from(row.querySelectorAll<HTMLElement>(ROW_ITEMS)).filter(
        el => isVisible(el) && !el.hasAttribute('disabled') && el.tabIndex !== -1,
      );
      if (items.length === 0) return false;
      const idx = items.indexOf(active);
      if (idx === -1) return false;
      const target = items[(idx + dirKey + items.length) % items.length];
      if (!target) return false;
      e.preventDefault();
      e.stopPropagation();
      target.focus({ preventScroll: true });
      return true;
    };

    const handler = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return;

      // Plain ↑/↓ without modifiers = in-region item walk; plain ←/→ inside
      // a marked toolbar strip = item walk; ⌘⌃+arrows are the section cycler
      // and are matched below.
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (walkList(e)) return;
      }

      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        if (walkRow(e)) return;
      }

      let dir = 0; // 1 = next section, -1 = previous section
      if (e.key === 'F6' && (e.metaKey || e.ctrlKey || e.key === 'F6')) {
        // Covers plain F6 + ⌘/Ctrl F6 pairs from Slack's browser model.
        dir = e.shiftKey ? -1 : 1;
      } else if (e.metaKey && e.ctrlKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        // Slack desktop-app model (Mac)
        dir = e.key === 'ArrowRight' ? 1 : -1;
      }
      if (dir === 0) return;
      // eslint-disable-next-line no-console -- TEMP region-nav debug
      console.log('[regionnav] combo', {
        key: e.key,
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        dir,
      });

      // Respect modal focus traps entirely.
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest?.('[role="dialog"][aria-modal="true"], [data-overlay-portal]')) {
        // eslint-disable-next-line no-console -- TEMP region-nav debug
        console.log('[regionnav] skipped: inside a modal');
        return;
      }

      const regions = Array.from(document.querySelectorAll<HTMLElement>(REGION_SELECTOR)).filter(
        isVisible,
      );
      // eslint-disable-next-line no-console -- TEMP region-nav debug
      console.log(
        '[regionnav] regions',
        regions.map(r => r.getAttribute('data-focus-region')),
      );
      if (regions.length < 2) return;

      const current = active ? active.closest<HTMLElement>(REGION_SELECTOR) : null;
      const currentIndex = current ? regions.indexOf(current) : -1;
      const nextIndex =
        currentIndex === -1
          ? dir === 1
            ? 0
            : regions.length - 1
          : (currentIndex + dir + regions.length) % regions.length;
      const region = regions[nextIndex];
      if (!region) return;

      // Seats must belong to THIS region — regions nest (the composer lives
      // inside `conversation`), and a naive querySelector drills into the
      // nested region and steals its seat, making every hop land in the
      // message field instead of walking section by section.
      const seat = Array.from(region.querySelectorAll<HTMLElement>(SEAT_SELECTOR)).find(
        s => s.closest(REGION_SELECTOR) === region,
      );
      const fallbackFocusable = Array.from(
        region.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).find(s => s.closest(REGION_SELECTOR) === region && isVisible(s));
      const target = seat ?? fallbackFocusable ?? region;
      if (!target.getAttribute('tabindex') && !target.matches(FOCUSABLE_SELECTOR)) {
        target.setAttribute('tabindex', '-1');
      }

      // eslint-disable-next-line no-console -- TEMP region-nav debug
      console.log('[regionnav] moving', {
        from: currentIndex,
        to: nextIndex,
        region: region.getAttribute('data-focus-region'),
        seat: seat
          ? seat.getAttribute('aria-label') ||
            seat.getAttribute('href') ||
            seat.className.replaceAll(' ', '.').slice(0, 80)
          : null,
      });
      e.preventDefault();
      e.stopPropagation();
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      // eslint-disable-next-line no-console -- TEMP region-nav debug
      console.log(
        '[regionnav] activeElement is now',
        document.activeElement?.tagName,
        (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ??
          (document.activeElement as HTMLElement | null)?.getAttribute('href') ??
          document.activeElement?.className.replaceAll(' ', '.').slice(0, 80),
      );
    };

    document.addEventListener('keydown', handler, true);
    return (): void => document.removeEventListener('keydown', handler, true);
  }, []);
};
