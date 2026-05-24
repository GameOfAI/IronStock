import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';

const fetchMock = vi.fn();

function renderPage() {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ImportPageWrapper />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let ImportPageWrapper: React.FC;

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock);
  useAuthStore.setState({
    user: { id: '1', username: 'user1', roles: ['write'] },
    accessToken: 'test-token',
  });
  const mod = await import('./import');
  const Page = mod.default;
  ImportPageWrapper = () => <Page />;
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('ImportPage', () => {
  it('module exports a default component', async () => {
    const mod = await import('./import');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('renders page heading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Toplu İçe Aktarma')).toBeInTheDocument();
    });
  });
});
