import { Component, type ErrorInfo, type ReactNode } from 'react';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Bulletin Builder renderer failed', error, info); }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="fatal-error" role="alert"><div className="brand-mark">!</div><div className="eyebrow">Something needs attention</div><h1>Bulletin Builder couldn’t display this workspace.</h1><p>{this.state.error.message}</p><button className="primary" onClick={() => location.reload()}>Reload application</button></main>;
  }
}
