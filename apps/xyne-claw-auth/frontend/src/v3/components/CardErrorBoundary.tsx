import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps one bad card from taking the conversation with it.
 *
 * A message's attachments are persisted, so an uncaught render error does not
 * just break the view once — it throws again on every reload and the thread
 * can never be opened. Anything rendered from model-authored data belongs
 * inside one of these: the validator is the first line, this is the second,
 * and the second is what stops a validator gap becoming data loss.
 *
 * Deliberately a plain class component — React offers no hook equivalent.
 */
export class CardErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced rather than swallowed: a card that fails for everyone should be
    // visible in logs, not silently degraded.
    console.error(`[${this.props.label ?? "card"}] render failed`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        data-id="card-error-boundary"
        className="rounded-lg border border-xyne-border-subtle px-3 py-2.5 text-[12px] text-xyne-fg-muted"
      >
        This card could not be displayed. The rest of the conversation is unaffected, and the
        attached files are still below.
      </div>
    );
  }
}
