import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto max-w-xl px-4 py-24">
        <h1 className="text-2xl font-bold">The dashboard stopped</h1>
        <p className="mt-3 text-muted">Your funds are not affected; this is only the page. Reload to try again.</p>
        <pre className="mt-6 overflow-x-auto bg-raised p-4 text-xs text-muted">{this.state.error.message}</pre>
        <button onClick={() => location.reload()} className="mt-6 h-11 bg-ink px-4 text-sm font-semibold text-paper">
          Reload
        </button>
      </main>
    );
  }
}
