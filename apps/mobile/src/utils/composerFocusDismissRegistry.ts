type ComposerFocusDismissHandler = () => void;

const handlers = new Set<ComposerFocusDismissHandler>();

export function registerComposerFocusDismissHandler(
  handler: ComposerFocusDismissHandler,
): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function dismissRegisteredComposerFocus(): void {
  for (const handler of Array.from(handlers)) {
    handler();
  }
}
