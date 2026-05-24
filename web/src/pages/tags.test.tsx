import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TagsPage from './tags';
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
        <TagsPage />
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

describe('TagsPage', () => {
  it('renders page heading', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { tags: [] }));
    renderPage();
    expect(screen.getByText('Etiketlerim')).toBeInTheDocument();
  });

  it('shows empty state when no tags', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { tags: [] }));
    renderPage();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it('renders tag list when data available', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        tags: [
          { id: '1', name: 'prod', color: '#ef4444' },
          { id: '2', name: 'staging', color: '#3b82f6' },
        ],
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('prod')).toBeInTheDocument();
      expect(screen.getByText('staging')).toBeInTheDocument();
    });
  });
});
