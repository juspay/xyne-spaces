/* Obsidian callout type → display label + icon + tone.
 * Tone is a stable key consumed by the component layer (obsidianComponents). */
export type CalloutMeta = { label: string; icon: string; tone: string };

const LABELS: Record<string, CalloutMeta> = {
  note: { label: 'Note', icon: '✎', tone: 'blue' },
  info: { label: 'Info', icon: 'ℹ', tone: 'blue' },
  todo: { label: 'Todo', icon: '☑', tone: 'blue' },
  tip: { label: 'Tip', icon: '★', tone: 'teal' },
  hint: { label: 'Tip', icon: '★', tone: 'teal' },
  important: { label: 'Important', icon: '❗', tone: 'teal' },
  abstract: { label: 'Abstract', icon: '❋', tone: 'teal' },
  summary: { label: 'Summary', icon: '❋', tone: 'teal' },
  success: { label: 'Success', icon: '✔', tone: 'green' },
  check: { label: 'Success', icon: '✔', tone: 'green' },
  done: { label: 'Done', icon: '✔', tone: 'green' },
  question: { label: 'Question', icon: '?', tone: 'amber' },
  faq: { label: 'FAQ', icon: '?', tone: 'amber' },
  warning: { label: 'Warning', icon: '⚠', tone: 'amber' },
  caution: { label: 'Caution', icon: '⚠', tone: 'amber' },
  attention: { label: 'Attention', icon: '⚠', tone: 'amber' },
  failure: { label: 'Failure', icon: '✘', tone: 'red' },
  danger: { label: 'Danger', icon: '⚡', tone: 'red' },
  error: { label: 'Error', icon: '✘', tone: 'red' },
  bug: { label: 'Bug', icon: '⌾', tone: 'red' },
  example: { label: 'Example', icon: '❖', tone: 'purple' },
  quote: { label: 'Quote', icon: '❝', tone: 'gray' },
  cite: { label: 'Quote', icon: '❝', tone: 'gray' },
};

export function calloutMeta(type: string): CalloutMeta {
  return (
    LABELS[type] ?? {
      label: type.charAt(0).toUpperCase() + type.slice(1),
      icon: '◆',
      tone: 'gray',
    }
  );
}
