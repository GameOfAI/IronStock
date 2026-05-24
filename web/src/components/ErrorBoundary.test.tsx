import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow = false;
function ThrowingChild() {
  if (shouldThrow) throw new Error('Test error');
  return <div>Child rendered</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    shouldThrow = false;
    render(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('shows error UI when child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Bir şeyler ters gitti')).toBeInTheDocument();
    expect(screen.getByText(/Beklenmeyen bir hata oluştu/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('shows retry button that resets error state', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Bir şeyler ters gitti')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByText('Tekrar Dene'));

    expect(screen.getByText('Child rendered')).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
