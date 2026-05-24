import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroupsPage from './groups';
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
        <GroupsPage />
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

describe('GroupsPage', () => {
  it('renders page heading', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { groups: [] }));
    renderPage();
    expect(screen.getByText('Gruplar')).toBeInTheDocument();
  });

  it('shows create group button', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { groups: [] }));
    renderPage();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('renders group list when data available', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        groups: [
          { id: 'g1', name: 'DevOps Team', member_count: 5 },
          { id: 'g2', name: 'Backend Team', member_count: 3 },
        ],
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DevOps Team')).toBeInTheDocument();
      expect(screen.getByText('Backend Team')).toBeInTheDocument();
    });
  });
});
