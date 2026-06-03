import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PipelinePage from './index';
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
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('test-token');
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('PipelinePage', () => {
  it('renders page heading', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { diagrams: [] }));
    renderPage();
    expect(screen.getByText('Pipeline Diyagramları')).toBeInTheDocument();
  });

  it('shows create button', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { diagrams: [] }));
    renderPage();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('renders diagram list when data available', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        diagrams: [
          { id: 'd1', name: 'Production Pipeline', description: 'Main deploy flow', node_count: 5, created_at: new Date().toISOString() },
          { id: 'd2', name: 'Staging Pipeline', description: 'Test env', node_count: 3, created_at: new Date().toISOString() },
        ],
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Production Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Staging Pipeline')).toBeInTheDocument();
    });
  });
});
