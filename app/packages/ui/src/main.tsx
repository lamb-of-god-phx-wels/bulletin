import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RendererApplication } from "./app/index.js";
import "./design-system/tokens.css";
import "./app/app.css";

interface RendererErrorBoundaryState {
  readonly message?: string;
}

class RendererErrorBoundary extends Component<
  { readonly children: ReactNode },
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = {};

  static getDerivedStateFromError(error: unknown): RendererErrorBoundaryState {
    return {
      message: error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "The application renderer stopped unexpectedly.",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Keep detailed component stacks in local developer diagnostics only.
    console.error("Renderer failure", error, info.componentStack);
  }

  render() {
    if (this.state.message === undefined) return this.props.children;
    return (
      <main className="cbb-theme cbb-startup-state" data-cbb-theme="system">
        <section className="cbb-card cbb-startup-card" aria-labelledby="cbb-renderer-failure-title">
          <h1 id="cbb-renderer-failure-title">Church Bulletin Builder needs to restart</h1>
          <p role="alert">{this.state.message}</p>
          <button className="cbb-button cbb-button--primary" type="button" onClick={() => window.location.reload()}>
            Restart the window
          </button>
        </section>
      </main>
    );
  }
}

const rootElement = document.getElementById("cbb-root");
if (rootElement === null) throw new Error("The application root is missing.");

createRoot(rootElement).render(
  <RendererErrorBoundary>
    <RendererApplication />
  </RendererErrorBoundary>,
);
