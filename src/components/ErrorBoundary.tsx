// A render error stays where it happened: one card, the board, a view — never the whole window.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** What to show instead (gets the error and a reset). */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Re-try automatically when this value changes (e.g. the card's data). */
  resetKey?: unknown;
  /** Where it happened, for the log. */
  where?: string;
}

interface State {
  error: Error | null;
  key: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // new data: try again
    if (props.resetKey !== state.key) return { key: props.resetKey, error: null };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.where ?? "view"}] render error:`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="m-4 rounded-lg border border-err/40 bg-err/5 p-4 text-[12.5px]">
        <div className="font-semibold text-err">Something went wrong here{this.props.where ? ` (${this.props.where})` : ""}.</div>
        <div className="mt-1 font-mono text-[11px] text-muted">{error.message}</div>
        <div className="mt-3 flex gap-2">
          <button className="rounded border border-line px-2 py-1 hover:bg-white/5" onClick={this.reset}>Try again</button>
          <button className="rounded border border-line px-2 py-1 hover:bg-white/5" onClick={() => location.reload()}>Reload the window</button>
        </div>
      </div>
    );
  }
}
