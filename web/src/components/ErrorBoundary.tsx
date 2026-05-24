import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-lg">
          <h1 className="mb-2 text-xl font-semibold text-destructive">
            Bir şeyler ters gitti
          </h1>
          <p className="mb-4 text-sm text-muted-foreground">
            Beklenmeyen bir hata oluştu. Lütfen sayfayı yeniden yüklemeyi deneyin.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mb-4 max-h-40 overflow-auto rounded bg-muted p-3 text-left text-xs">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Tekrar Dene
          </button>
        </div>
      </div>
    );
  }
}
