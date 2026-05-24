import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './login';

const fetchMock = vi.fn();

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ providers: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('renders heading', () => {
    renderPage();
    expect(screen.getByText('Giriş Yap')).toBeInTheDocument();
  });

  it('renders username and password inputs', () => {
    renderPage();
    expect(screen.getByPlaceholderText('admin')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
  });

  it('renders submit button with Giriş Yap text', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Giriş Yap')).toBeInTheDocument();
    });
  });
});
