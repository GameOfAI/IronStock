import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { setAccessToken } from '@/api/token-storage';

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
        <SecretScanningPageWrapper />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let SecretScanningPageWrapper: React.FC;

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('test-token');
  useAuthStore.setState({
    user: { id: '1', username: 'admin', roles: ['admin'] },
    accessToken: 'test-token',
  });
  const mod = await import('./secret-scanning');
  const Page = mod.default;
  SecretScanningPageWrapper = () => <Page />;
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('SecretScanningPage', () => {
  it('module exports a default component', async () => {
    const mod = await import('./secret-scanning');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('renders page heading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Gizli Bilgi Sızıntısı Taraması')).toBeInTheDocument();
    });
  });

  it('renders scan endpoint section', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Scan Endpoint')).toBeInTheDocument();
    });
  });
});
