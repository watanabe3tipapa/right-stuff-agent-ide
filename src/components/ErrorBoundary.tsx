import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last line of defence for the WebView. A rendering error in any panel should
 * leave the window usable instead of turning the whole UI blank.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="fatal-error" role="alert">
        <div className="fatal-error-card">
          <p className="fatal-error-code">RUNTIME ERROR</p>
          <h1>画面の描画中にエラーが発生しました</h1>
          <p>
            作業内容はできるだけ保持されています。再読み込みして復帰してください。
            繰り返し発生する場合は、下の詳細を添えて Issue で報告してください。
          </p>
          <pre className="fatal-error-detail">{error.stack ?? error.message}</pre>
          <div className="fatal-error-actions">
            <button type="button" className="btn primary" onClick={this.reload}>
              再読み込み
            </button>
            <a
              className="btn ghost"
              href="https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues"
              target="_blank"
              rel="noreferrer"
            >
              Issue を開く
            </a>
          </div>
        </div>
      </div>
    );
  }
}
