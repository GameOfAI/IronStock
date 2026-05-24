import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import K8sClustersPage from './k8s-clusters';
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
        <K8sClustersPage />
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

describe('K8sClustersPage', () => {
  it('renders page heading', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { clusters: [] }));
    renderPage();
    expect(screen.getByRole('heading')).toBeInTheDocument();
  });

  it('renders cluster list when data available', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        clusters: [
          { id: 'c1', name: 'production', api_url: 'https://k8s.prod.local:6443', status: 'connected' },
          { id: 'c2', name: 'staging', api_url: 'https://k8s.stg.local:6443', status: 'disconnected' },
        ],
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('production')).toBeInTheDocument();
      expect(screen.getByText('staging')).toBeInTheDocument();
    });
  });
});
