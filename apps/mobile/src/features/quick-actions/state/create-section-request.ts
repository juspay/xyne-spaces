import { observable } from '@legendapp/state';

/**
 * A request, from the quick-action button, to start creating a section.
 *
 * A counter rather than a boolean: it is an event, not a state. The screen that
 * owns the section tray reacts to each increment, so two requests in a row both
 * open it, and nothing has to reset a flag afterwards.
 */
export const createSectionRequests$ = observable(0);

export function requestCreateSection(): void {
  createSectionRequests$.set(createSectionRequests$.peek() + 1);
}
