/**
 * Global ErrorBoundary — catches unhandled React render errors and shows
 * a recovery UI instead of a white screen.
 *
 * Accepts an optional `resetKey` prop (typically the current pathname).
 * When `resetKey` changes the error state auto-clears, so sidebar navigation
 * works even after a crash — clicking another page resets the boundary.
 *
 * `RouteErrorBoundary` is a convenience wrapper that reads the pathname
 * from React Router and passes it as `resetKey`.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Core class component
// ---------------------------------------------------------------------------

interface Props {
  children: ReactNode;
  /** When this value changes the error state is cleared automatically. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    // When the route (resetKey) changes, clear the error so the new page renders.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/inventory';
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <div className="w-full max-w-md space-y-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/30">
              <svg
                className="h-8 w-8 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>

            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Bir hata oluştu
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Sayfa beklenmeyen bir hatayla karşılaştı.
                Sol menüden başka bir sayfaya geçebilir veya aşağıdaki seçenekleri kullanabilirsiniz.
              </p>
            </div>

            {this.state.error && (
              <pre className="rounded-md bg-muted p-3 text-left text-xs text-muted-foreground overflow-auto max-h-24">
                {this.state.error.message}
              </pre>
            )}

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleGoHome}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Ana Sayfaya Dön
              </button>
              <button
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Sayfayı Yenile
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Route-aware wrapper (reads pathname from React Router)
// ---------------------------------------------------------------------------

/**
 * ErrorBoundary that auto-resets when the URL pathname changes.
 * Use this inside a React Router context (e.g. wrapping <Outlet />).
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}
