import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReportsPage from './reports';
import { useAuthStore } from '@/store/auth';
import { setAccessToken } from '@/api/token-storage';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('test-token');
  useAuthStore.setState({
    user: { id: '1', username: 'admin', roles: ['admin'] },
    accessToken: 'test-token',
  });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('ReportsPage', () => {
  it('renders page heading', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    renderPage();
    expect(screen.getByText('Raporlar')).toBeInTheDocument();
  });

  it('renders generate button', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    renderPage();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });
});
