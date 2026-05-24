import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { setAccessToken } from '@/api/token-storage';

const fetchMock = vi.fn();

function renderPage() {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ nodes: [], edges: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GraphPageWrapper />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let GraphPageWrapper: React.FC;

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('test-token');
  useAuthStore.setState({
    user: { id: '1', username: 'admin', roles: ['admin'] },
    accessToken: 'test-token',
  });
  const mod = await import('./graph');
  const GraphPage = mod.GraphPage;
  GraphPageWrapper = () => <GraphPage />;
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('GraphPage', () => {
  it('module exports GraphPage component', async () => {
    const mod = await import('./graph');
    expect(mod.GraphPage).toBeDefined();
    expect(typeof mod.GraphPage).toBe('function');
  });

  it('shows loading state initially', () => {
    renderPage();
    expect(screen.getByText('Graf yükleniyor…')).toBeInTheDocument();
  });

  it('renders heading after data loads', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('İlişki Haritası')).toBeInTheDocument();
    });
  });
});
